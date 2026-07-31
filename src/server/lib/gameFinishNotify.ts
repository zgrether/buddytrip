import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { gameHref } from "@/lib/gameRoutes";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { sendPushToUsers } from "./sendPushToUsers";

/**
 * The `scores` category's ONE wire point (Push Phase 3).
 *
 * `games.finish` is now the only finalize for every format (the `games.post`
 * fork was merged away), so this hangs off one procedure and covers all four:
 * match, rack, stroke, and the non-golf manual arm. Two notifications come out
 * of it — "a game is final" and, when it becomes true, "the cup is clinched".
 *
 * ── What is NOT wired, and must never be ────────────────────────────────────
 * NOTIFICATIONS.md marks `scores.upsertEntry` / `deleteEntry` (~540/day),
 * pairing setup, and handicap/point-value tweaks as NEVER — permanent
 * properties of those events, not judgment calls. Nothing here touches them,
 * and `pushCallSites.guard.test.ts` fails the build if a NEVER site ever
 * imports a send helper. Volume discipline IS the product: three notification
 * kinds, ~10-30 events across a tournament day.
 *
 * ── Failure isolation ───────────────────────────────────────────────────────
 * Every function here swallows its own errors. A push failure must never roll
 * back a finished game — the same shape the Realtime cascade established, where
 * `realtime.send` swallows its errors and the trigger is defensive. The caller
 * awaits (rather than firing and forgetting) because un-awaited work can be
 * killed when a serverless function freezes, and a notification that races the
 * response is a notification that sometimes doesn't happen.
 */

/** Payload copy is built here, in one place, so the three notifications can be
 *  read side by side and reviewed as a set rather than found in three files. */
const COPY = {
  /** Engine formats (match / rack / stroke) — computed from entered scores. */
  gameFinal: (gameName: string | null) => ({
    title: gameName ? `Final: ${gameName}` : "A game is final",
    body: "Results are in — tap to see how it finished.",
  }),
  /** Manual arm (non-golf side events: euchre, cornhole, pool, poker). */
  resultPosted: (gameName: string | null) => ({
    title: gameName ? `Result posted: ${gameName}` : "A result was posted",
    body: "The cup standings just moved.",
  }),
  /** The highest-value push in the app — ~1-3 per trip. */
  clinched: (teamName: string, competitionName: string | null) => ({
    title: `🏆 ${teamName} clinched`,
    body: competitionName
      ? `${competitionName} is decided. Tap for the final board.`
      : "The cup is decided. Tap for the final board.",
  }),
};

/**
 * Deep links, verified against CURRENT routing (the shell has been restructured
 * repeatedly, and a push URL is the one link you cannot fix after it ships).
 *
 * A competition game opens as a PANEL over the persistent board: `?view=cup` is
 * REQUIRED alongside `?game=` — a bare `?game=` falls back to the Trip tab and
 * hides the very panel it opened (the bug documented in `GameRow.tsx`).
 * `useCupPanel` explicitly supports a cold `?game=` deep link.
 *
 * A standalone game (no competition — ~40% of games in production) has no board
 * to panel over, so it routes to its own page via the shared `gameHref` builder.
 *
 * `/trips/{id}/leaderboard` is deliberately NOT used: it is a client-side alias
 * that `router.replace`s to `?view=cup`, costing an extra hop and an extra
 * fetch. The canonical form is the one that goes on someone's phone.
 */
function gameUrl(
  tripId: string,
  gameId: string,
  gameTypeId: string | null,
  competitionId: string | null
): string {
  if (competitionId) return `/trips/${tripId}?view=cup&game=${gameId}`;
  return gameHref(tripId, gameTypeId, gameId) ?? `/trips/${tripId}?view=cup`;
}

function cupUrl(tripId: string): string {
  return `/trips/${tripId}?view=cup`;
}

/**
 * Who hears about a finished game.
 *
 * ENGINE formats → the game's PARTICIPANTS. They played it; the result is their
 * news. ~4-8 people, so a person gets ~1-2 of these on a tournament day rather
 * than one per game on the board. Cup-wide news is what the clinch push is for,
 * and the board itself is already live via the score-event broadcast.
 *
 * MANUAL arm → the COMPETITION's assigned members. Non-golf side events are
 * team-scoped and have NO individual roster — `game_participants` is not
 * populated for them, so "the game's participants" isn't a resolvable audience.
 * They're also rare (~1-5 per trip), so the wider audience stays cheap.
 *
 * Guests (`users.is_guest`) need no special handling: a placeholder has no
 * account and therefore no push subscription, so it falls out at the device read.
 */
async function resolveAudience(
  admin: SupabaseClient,
  gameId: string,
  competitionId: string | null,
  isManual: boolean
): Promise<string[]> {
  if (isManual && competitionId) {
    const { data } = await admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", competitionId);
    const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
    if (ids.length > 0) return ids;
    // Fall through: a manual game whose competition has no assignments yet.
  }
  const { data } = await admin
    .from("game_participants")
    .select("user_id")
    .eq("game_id", gameId);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

export interface NotifyGameFinishedInput {
  tripId: string;
  gameId: string;
  gameName: string | null;
  gameTypeId: string | null;
  competitionId: string | null;
  /** True for the `result_strategy: null` (manual / non-golf) arm. */
  isManual: boolean;
  /** The user who finalized. Never notified about their own action. */
  actorUserId: string;
  /** Injectable for tests; defaults to the service-role admin client. */
  admin?: SupabaseClient;
}

/**
 * Fire the "game is final" push, then check whether that finalize decided the
 * cup. Never throws.
 *
 * IDEMPOTENCE is the caller's job for the game push: `finish` is deliberately
 * re-runnable (a correction cycle is openCorrection → edit → finish again, and
 * at BBMI both golf formats in play have that wired, so it is a real sequence
 * rather than a hypothetical), so the caller only invokes this on the
 * pending/active → complete TRANSITION. A re-finish of an already-complete game
 * notifies nobody. The clinch half carries its own separate guard, below,
 * because it can become true on a finalize that is not itself a transition.
 */
export async function notifyGameFinished(input: NotifyGameFinishedInput): Promise<void> {
  try {
    const admin = input.admin ?? createAdminClient();

    const audience = await resolveAudience(
      admin,
      input.gameId,
      input.competitionId,
      input.isManual
    );

    const copy = input.isManual
      ? COPY.resultPosted(input.gameName)
      : COPY.gameFinal(input.gameName);

    await sendPushToUsers(audience, "scores", {
      ...copy,
      url: gameUrl(input.tripId, input.gameId, input.gameTypeId, input.competitionId),
      // Coalesce per game: a correction → re-finish replaces the earlier notice
      // on the device instead of stacking a second one next to it.
      tag: `bt-game-${input.gameId}`,
    }, { excludeUserId: input.actorUserId });
  } catch (err) {
    console.error("[notifyGameFinished] failed", { gameId: input.gameId, err });
  }
}

/**
 * Atomically claim the right to announce `teamId` as the clincher. Returns true
 * exactly once per (competition, team) — the caller sends only when it wins.
 *
 * Exported so the PostgREST filter below can be tested against a REAL database
 * rather than a stub, because a stub would happily accept a filter that means
 * something else. `.or(is.null, neq)` is how PostgREST expresses SQL's
 * `IS DISTINCT FROM`: `.not("col","is",value)` only accepts null/true/false, and
 * a bare `.neq()` would match NOTHING while the column is still NULL — which is
 * the state EVERY first clinch starts in. That failure mode is silent and points
 * the wrong way: the highest-value push in the app simply never sends.
 *
 * `.select()` is required — without it Supabase reports no affected rows and the
 * claim would always read as lost.
 */
export async function claimClinchNotification(
  admin: SupabaseClient,
  competitionId: string,
  teamId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("competitions")
    .update({ clinch_notified_team_id: teamId })
    .eq("id", competitionId)
    .or(`clinch_notified_team_id.is.null,clinch_notified_team_id.neq.${teamId}`)
    .select("id");
  return !error && !!data && data.length > 0;
}

export interface NotifyCupClinchedInput {
  tripId: string;
  competitionId: string;
  actorUserId: string;
  admin?: SupabaseClient;
}

/**
 * Send the clinch push if — and only if — the cup is now decided AND we have not
 * already announced that team.
 *
 * Clinch is DERIVED, never stored: `computeCompetitionLeaderboard` returns
 * `pointsToClinch`, and `<= 0` means clinched. That predicate is duplicated
 * nowhere — it is the same `(pointsToClinch[t.id] ?? 1) <= 0` the board pill and
 * `GamePageHeader` already use, so the notification and the UI cannot disagree
 * about whether the cup is decided.
 *
 * Exactly-once comes from the CONDITIONAL claim (migration 099): the UPDATE only
 * matches when `clinch_notified_team_id IS DISTINCT FROM` the clincher, so two
 * clients finishing two different games concurrently race for one row and
 * exactly one sends. `IS DISTINCT FROM` rather than `<>` is what makes a NULL
 * current value read as "unclaimed" instead of matching nothing.
 *
 * The claim is written with the SERVICE-ROLE client and this is load-bearing:
 * `competitions_update` requires trip Owner/Organizer, but a game delegate who
 * is a plain trip Member can finalize a game. Through the caller's client the
 * claim would fail SILENTLY for exactly the person most likely to be finishing
 * the deciding game on-site.
 */
export async function notifyCupClinchedIfDecided(
  input: NotifyCupClinchedInput
): Promise<void> {
  try {
    const admin = input.admin ?? createAdminClient();

    const board = await computeCompetitionLeaderboard(admin, input.competitionId);
    const teams = (board.teams ?? []) as { id: string; name: string | null }[];
    const clincher =
      teams.find((t) => (board.pointsToClinch?.[t.id] ?? 1) <= 0) ?? null;
    if (!clincher) return;

    const won = await claimClinchNotification(admin, input.competitionId, clincher.id);
    if (!won) return;

    const { data: comp } = await admin
      .from("competitions")
      .select("name")
      .eq("id", input.competitionId)
      .maybeSingle();

    const { data: assignments } = await admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", input.competitionId);
    const audience = (assignments ?? []).map((r: { user_id: string }) => r.user_id);

    await sendPushToUsers(
      audience,
      "scores",
      {
        ...COPY.clinched(clincher.name ?? "A team", (comp?.name as string | null) ?? null),
        url: cupUrl(input.tripId),
        tag: `bt-clinch-${input.competitionId}`,
      },
      { excludeUserId: input.actorUserId }
    );
  } catch (err) {
    console.error("[notifyCupClinchedIfDecided] failed", {
      competitionId: input.competitionId,
      err,
    });
  }
}
