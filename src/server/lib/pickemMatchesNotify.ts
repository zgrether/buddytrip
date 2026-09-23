import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { sendPushToUsers, type SendPushToUsersResult } from "./sendPushToUsers";
import type { PushPayload } from "./sendPush";
import { gameUrl } from "./gameFinishNotify";
import { resolvesToIndividualMatches } from "@/lib/pickemFinalize";

/**
 * "Results are coming in on a pick'em nobody has drawn matches for" — the push
 * to a game's RUNNERS (results-first PR, Zach 2026-09-23).
 *
 * ── Why this moment, and only this one ─────────────────────────────────────
 *
 * The runner's strip sharpens at LOCK too, but a deadline passing has no actor
 * — time moves and no code runs — so the lock can be DISPLAYED and never
 * ANNOUNCED (#1076 carries the general form). The first final result is the
 * one moment in this sequence where someone does something, so the push hangs
 * off it: `pickem.setResult`, on the none-to-some transition of results.
 *
 * ── Who ─────────────────────────────────────────────────────────────────────
 *
 * The people who can act: the trip's Owners and Organizers, and the game's
 * delegates — `requireGameEdit`'s set. EXCLUDING whoever entered the result:
 * they are on the page, and their strip has just sharpened in front of them.
 * In a one-runner game that leaves nobody, which is correct — the one person
 * who could act has already been told, by the screen.
 *
 * ── Duplicates are ACCEPTED, deliberately — do not add a claim column ─────
 *
 * The transition is read-before-write: count results, then write. Two runners
 * entering the FIRST result of the same game in the same instant can both
 * read zero and both send. That needs two runners racing on a game where one
 * of them has to have skipped drawing matches — rare enough that an
 * exactly-once claim (a migration and a column, like the clinch's) costs more
 * than the duplicate. Ruled by Zach, 2026-09-23; written here so the next
 * reader does not "fix" it reflexively.
 */

/** The pure decision — tested on its own, called with values read around the write. */
export function shouldNotifyMatchesNotDrawn(o: {
  /** Results already on the slate BEFORE this write. */
  priorResults: number;
  /** What this write set. Null clears a result, which is never a first result. */
  newResult: string | null;
  /** RESOLVED — points mode already folded in (`resolvesToIndividualMatches`). */
  individualMatches: boolean;
  /** Matches with BOTH sides set. */
  pairedMatches: number;
}): boolean {
  return o.newResult !== null && o.priorResults === 0 && o.individualMatches && o.pairedMatches === 0;
}

/** The game's runners: trip Owners + Organizers, and this game's delegates. */
export async function gameRunnerIds(admin: SupabaseClient, tripId: string, gameId: string): Promise<string[]> {
  const [orgRes, delRes] = await Promise.all([
    admin.from("trip_members").select("user_id").eq("trip_id", tripId).in("role", ["Owner", "Organizer"]),
    admin.from("game_delegates").select("user_id").eq("game_id", gameId),
  ]);
  const ids = new Set<string>();
  for (const r of orgRes.data ?? []) ids.add(r.user_id as string);
  for (const r of delRes.data ?? []) ids.add(r.user_id as string);
  return [...ids];
}

export function matchesNotDrawnPayload(o: {
  tripId: string;
  gameId: string;
  gameName: string | null;
  gameTypeId: string | null;
  competitionId: string | null;
}): PushPayload {
  const name = o.gameName?.trim() || "Pick'em";
  return {
    title: `${name}: draw the matches`,
    body: "Results are coming in and no matches are drawn yet. Draw them any time — they're scored from the results already in.",
    url: gameUrl(o.tripId, o.gameId, o.gameTypeId, o.competitionId),
    // One per game: a second send (the accepted race) replaces the first.
    tag: `pickem-matches-${o.gameId}`,
  };
}

/**
 * Read the game's state AFTER the write and send if it still qualifies. Runs
 * inside `afterResponse`, so it never delays or fails the result entry.
 */
export async function notifyPickemMatchesNotDrawn(
  input: { tripId: string; gameId: string; actorUserId: string; priorResults: number; newResult: string | null },
  opts: { admin?: SupabaseClient } = {}
): Promise<SendPushToUsersResult | null> {
  const admin = opts.admin ?? createAdminClient();
  const [gameRes, cfgRes, matchRes] = await Promise.all([
    admin.from("games").select("name, game_type_id, competition_id").eq("id", input.gameId).maybeSingle(),
    admin.from("pickem_games").select("roll_up").eq("game_id", input.gameId).maybeSingle(),
    admin.from("game_matches").select("side_a, side_b").eq("game_id", input.gameId),
  ]);
  const game = gameRes.data;
  if (!game) return null;
  const competitionId = (game.competition_id as string | null) ?? null;
  let pointsMode = false;
  if (competitionId) {
    const { data: comp } = await admin.from("competitions").select("scoring_model").eq("id", competitionId).maybeSingle();
    pointsMode = (comp?.scoring_model as string | null) === "points";
  }
  const rollUp = ((cfgRes.data?.roll_up as string | null) ?? "team_totals") as "team_totals" | "individual_matches";
  const paired = (matchRes.data ?? []).filter((m) => {
    const a = m.side_a as { id?: string } | null;
    const b = m.side_b as { id?: string } | null;
    return !!a?.id && !!b?.id;
  }).length;

  if (
    !shouldNotifyMatchesNotDrawn({
      priorResults: input.priorResults,
      newResult: input.newResult,
      individualMatches: resolvesToIndividualMatches({ rollUp, pointsMode }),
      pairedMatches: paired,
    })
  ) {
    return null;
  }

  const runners = await gameRunnerIds(admin, input.tripId, input.gameId);
  return sendPushToUsers(
    runners,
    "organizer",
    matchesNotDrawnPayload({
      tripId: input.tripId,
      gameId: input.gameId,
      gameName: (game.name as string | null) ?? null,
      gameTypeId: (game.game_type_id as string | null) ?? null,
      competitionId,
    }),
    {
      admin,
      excludeUserId: input.actorUserId,
      context: {
        trigger: "pickem_matches_not_drawn",
        tripId: input.tripId,
        gameId: input.gameId,
        competitionId,
        actorUserId: input.actorUserId,
      },
    }
  );
}
