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

// ── Copy ────────────────────────────────────────────────────────────────────
// All three notifications live here so they read as a set. Three rules they
// share, each of which cost something to learn:
//
//  1. THE BODY CARRIES THE RESULT. `games.finish` has the outcome in hand at
//     send time, so a body that says "tap to see how it finished" is spending
//     the most valuable line on the lock screen to state that notifications are
//     tappable. Everyone knows that. Those characters carry the score instead.
//  2. NO "Result posted". That is the exact phrasing for `scores.upsertEntry` —
//     a NEVER-marked site — so on a lock screen it reads as "someone entered a
//     score", which is precisely the notification we promise never to send.
//     Golf and non-golf are the SAME event to the person holding the phone:
//     a game finished. Both title as `Final: {game}`. The audiences differ; the
//     copy does not.
//  3. NO EMOJI. Titles get cut around 40-50 characters on Android and every
//     character spent on decoration is a character not spent on the result.

/** Points arrive in halves (tie-averaging), and "2.5" reads like a spreadsheet.
 *  Whole numbers stay bare; a lone half is "½", not "0½". */
export function formatPoints(n: number): string {
  const rounded = Math.round(n * 2) / 2;
  if (rounded !== n) return String(n); // not a half-step — show it honestly
  const whole = Math.trunc(rounded);
  const hasHalf = Math.abs(rounded - whole) === 0.5;
  if (!hasHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
function ordinal(position: number): string {
  return ORDINALS[position - 1] ?? `${position}th`;
}

/** One competitor's line in a finished game, name already resolved. */
export interface SummaryEntry {
  name: string;
  /** Points scored (match play, rack). Absent for pure placement formats. */
  points?: number | null;
  /** Finishing rank, 1 = best (manual placements, rack, stroke). */
  position?: number | null;
}

/** "A & B" for two, "A, B & C" for more. Serial comma omitted deliberately —
 *  this is a lock-screen line, not prose, and the ampersand already separates. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * AN ORDINAL IS NEVER REPEATED. "1st Centurions · 1st Manhattans" reads as a
 * mistake — two firsts look like a bug in the app, not a tie in the game. Tied
 * competitors therefore SHARE one ordinal slot rather than each printing their
 * own, and a tie that covers the whole field drops ordinals entirely because
 * "1st" is meaningless when nobody is behind it:
 *
 *   whole field, two   →  Tied: Centurions & Manhattans
 *   whole field, 3+    →  3-way tie: Centurions, Manhattans & Bootleggers
 *   partial tie        →  1st Centurions · 2nd Manhattans & Bootleggers
 *
 * The N-way form leads with the COUNT because that is the part still readable
 * when the name list gets cut — "3-way tie: Not Golfing, Just Vib…" still tells
 * you what happened, where a truncated bare list does not.
 */
function tieGroupLabel(names: string[], position: number, wholeField: boolean): string {
  if (names.length === 1) return `${ordinal(position)} ${names[0]}`;
  if (!wholeField) return `${ordinal(position)} ${joinNames(names)}`;
  return names.length === 2
    ? `Tied: ${joinNames(names)}`
    : `${names.length}-way tie: ${joinNames(names)}`;
}

/**
 * Group entries by finishing position, best first.
 *
 * Two ranking sources, because not every format writes a position: match play
 * stores team POINTS with a null position, so a drawn match is only detectable
 * as equal points. Grouping on the index instead would have made a 2–2 draw look
 * like two distinct places — which is exactly the "1st and 2nd on identical
 * scores" nonsense the tie handling exists to prevent.
 *
 * Where positions are absent, ranks are assigned competition-style (1, 1, 3):
 * a tied pair both hold 1st and the next competitor is 3rd, never 2nd.
 */
function rankGroups(entries: SummaryEntry[]): { position: number; entries: SummaryEntry[] }[] {
  const hasPositions = entries.every((e) => e.position != null);
  const ranked = [...entries].sort((x, y) => {
    if (hasPositions) return (x.position ?? 0) - (y.position ?? 0);
    return (y.points ?? 0) - (x.points ?? 0);
  });

  const groups: { position: number; entries: SummaryEntry[] }[] = [];
  let seen = 0;
  for (const e of ranked) {
    const last = groups[groups.length - 1];
    const tiedWithLast = last
      ? hasPositions
        ? last.entries[0].position === e.position
        : (last.entries[0].points ?? 0) === (e.points ?? 0)
      : false;
    if (last && tiedWithLast) last.entries.push(e);
    else groups.push({ position: hasPositions ? (e.position as number) : seen + 1, entries: [e] });
    seen += 1;
  }
  return groups;
}

/**
 * The result line that goes in the notification body, for TEAM-scoped formats
 * (match play, rack, non-golf). Stroke has its own shape — see below.
 *
 * Two shapes, built to read as siblings rather than as unrelated strings:
 *
 *   match play / rack →  Manhattans 2½ – Centurions 1½      (a score line)
 *   non-golf / 3+     →  1st Centurions · 2nd Manhattans    (a placement list)
 *
 * A head-to-head with exactly two sides and no tie gets the score line, because
 * that is how anyone would say it out loud. Everything else gets the placement
 * list, which scales past two — with points appended when the format has them,
 * so a 3-team rack still reports the margin.
 *
 * Returns "" when there is nothing worth saying; callers fall back to a body
 * that doesn't pretend to have a result.
 */
export function formatResultSummary(entries: SummaryEntry[]): string {
  const named = entries.filter((e) => e.name);
  if (named.length === 0) return "";

  const hasPoints = named.every((e) => typeof e.points === "number");
  const groups = rankGroups(named);
  const wholeFieldTied = groups.length === 1 && named.length > 1;

  // Head-to-head score line — two sides, both scored, genuinely separated. A
  // drawn match falls through to the tie form instead of printing "2 – 2",
  // which states the score but buries the outcome.
  if (hasPoints && named.length === 2 && !wholeFieldTied) {
    const [a, b] = [...named].sort((x, y) => (y.points ?? 0) - (x.points ?? 0));
    return `${a.name} ${formatPoints(a.points ?? 0)} – ${b.name} ${formatPoints(b.points ?? 0)}`;
  }

  return groups
    .map((g) => {
      const names = g.entries.map((e) => e.name);
      const label = tieGroupLabel(names, g.position, wholeFieldTied);
      // Points ride along only where they disambiguate — a tied group shares one
      // score, so it prints once rather than after every name.
      if (!hasPoints) return label;
      return `${label} ${formatPoints(g.entries[0].points ?? 0)}`;
    })
    .join(" · ");
}

/**
 * Stroke play: the top two, then a count of everyone else.
 *
 *   1st Zach Grether · 2nd BJ Dennison · +2
 *
 * A stroke field is the whole trip, not two sides — a full placement list would
 * be thirty names and would blow past any lock screen, so it is CAPPED. `+2`
 * says how many finished behind without naming them.
 *
 * ── DELIBERATE: this form does NOT express ties below first place ────────────
 * If 2nd and 3rd tie, one of them is shown as 2nd and the other is folded into
 * the `+N`. That is not an oversight and it is not worth "fixing": expressing a
 * mid-field tie would require either naming the tied group (re-expanding the
 * list this cap exists to bound) or an ordinal-skipping scheme that a
 * two-line notification has no room to explain. A tie for the LEAD is expressed,
 * because that is the part anyone reads the notification for. Anyone who wants
 * the full field taps through to the scorecard, which is exactly what the deep
 * link is for.
 */
export function formatStrokeSummary(entries: SummaryEntry[]): string {
  const named = entries.filter((e) => e.name);
  if (named.length === 0) return "";

  const groups = rankGroups(named);
  const shown: string[] = [];
  let accounted = 0;

  const lead = groups[0];
  const leadTied = lead.entries.length > 1;

  // A SHARED LEAD takes the whole headline: "Tied: A & B", then the count. The
  // runner-up slot is dropped in that case — when the lead is tied, who came
  // next is not the story, and naming them would push the line past a glance.
  shown.push(tieGroupLabel(lead.entries.map((e) => e.name), lead.position, leadTied));
  accounted += lead.entries.length;

  // Runner-up: ONE name only, and only when the lead is outright. See the note
  // above — a tie at this level is deliberately not expressed.
  if (!leadTied && groups[1]) {
    shown.push(`${ordinal(groups[1].position)} ${groups[1].entries[0].name}`);
    accounted += 1;
  }

  const rest = named.length - accounted;
  if (rest > 0) shown.push(`+${rest}`);
  return shown.join(" · ");
}

/**
 * The clinch margin: bare totals, top two, no names.
 *
 * Names are deliberately omitted here even though the game summary includes
 * them — the title already says who clinched, so repeating it in the body spends
 * a second copy of the longest word in the notification to say nothing new. The
 * line exists to answer "by how much", and `25½ – 20½` answers it.
 */
export function formatClinchMargin(totals: number[]): string {
  const top = [...totals].sort((a, b) => b - a).slice(0, 2);
  if (top.length < 2) return "";
  return `${formatPoints(top[0])} – ${formatPoints(top[1])}`;
}

const COPY = {
  /**
   * EVERY format — golf and non-golf alike. One event ("a game finished"), one
   * shape of copy. `summary` is the result line; when it's empty (a finalize
   * with nothing to report) the body says so plainly rather than inventing one.
   */
  gameFinal: (gameName: string | null, summary: string) => ({
    title: gameName ? `Final: ${gameName}` : "A game is final",
    body: summary || "Results are in.",
  }),
  /** The highest-value push in the app — ~1-3 per trip. */
  clinched: (teamName: string, competitionName: string | null, summary: string) => ({
    title: `${teamName} clinched`,
    body: [competitionName, summary].filter(Boolean).join(" · ") || "The cup is decided.",
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

/**
 * Load the finished game's result rows and resolve display names.
 *
 * ONE read path for every format rather than three, because `game_results` is
 * already the shared spine — the roll-up "never distinguishes computed from
 * entered", and neither does this. What differs per format is only which rows
 * are the competitors:
 *
 *  - match play / rack / non-golf → `entity_type = 'team'` (team ids → team names)
 *  - stroke                       → `entity_type = 'user'` (user ids → user names)
 *
 * Match play writes BOTH per-side rows AND team totals, so filtering on
 * entity_type is what keeps a 4-match game from reporting eight competitors.
 *
 * Returns [] on any failure — a notification without a result line is a minor
 * loss; a throw here would surface on a game that genuinely finished.
 */
async function loadSummaryEntries(
  admin: SupabaseClient,
  gameId: string,
  isStroke: boolean
): Promise<SummaryEntry[]> {
  try {
    const entityType = isStroke ? "user" : "team";
    const { data: rows } = await admin
      .from("game_results")
      .select("entity_id, raw_score, position")
      .eq("game_id", gameId)
      .eq("entity_type", entityType);
    if (!rows || rows.length === 0) return [];

    const ids = rows.map((r: { entity_id: string }) => r.entity_id);
    const { data: named } = await admin
      .from(isStroke ? "users" : "teams")
      .select("id, name")
      .in("id", ids);
    const nameById = new Map<string, string>(
      (named ?? []).map((n: { id: string; name: string | null }) => [n.id, n.name ?? ""])
    );

    return rows
      .map((r: { entity_id: string; raw_score: number | null; position: number | null }) => ({
        name: nameById.get(r.entity_id) ?? "",
        // A manual placement mirrors position into raw_score, which would read
        // as "points" and print "1st Centurions 1" — nonsense. Points are real
        // only where the format actually awards them (match play, rack).
        points: r.position != null && r.raw_score === r.position ? null : r.raw_score,
        position: r.position,
      }))
      .filter((e) => e.name);
  } catch {
    return [];
  }
}

export interface NotifyGameFinishedInput {
  tripId: string;
  gameId: string;
  gameName: string | null;
  gameTypeId: string | null;
  competitionId: string | null;
  /** True for the `result_strategy: null` (manual / non-golf) arm. Selects the
   *  AUDIENCE only — the copy is identical for golf and non-golf. */
  isManual: boolean;
  /** True for `stroke_total`, whose competitors are individuals, not teams. */
  isStroke: boolean;
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

    const entries = await loadSummaryEntries(admin, input.gameId, input.isStroke);
    // Stroke's field is the whole trip, so it gets the capped form; every other
    // format is team-scoped and small enough to list in full.
    const summary = input.isStroke
      ? formatStrokeSummary(entries)
      : formatResultSummary(entries);

    await sendPushToUsers(audience, "scores", {
      ...COPY.gameFinal(input.gameName, summary),
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

    // The cup standings AT the clinch — the same `teamTotals` the board renders,
    // so the notification and the board can't quote different numbers. Top two
    // only: the clincher is already named in the title, and the line exists to
    // say by how much.
    const totals = (board.teamTotals ?? {}) as Record<string, number>;
    const standingsLine = formatClinchMargin(teams.map((t) => totals[t.id] ?? 0));

    await sendPushToUsers(
      audience,
      "scores",
      {
        ...COPY.clinched(
          clincher.name ?? "A team",
          (comp?.name as string | null) ?? null,
          standingsLine
        ),
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
