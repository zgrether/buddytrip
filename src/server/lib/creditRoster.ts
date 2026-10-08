import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { rowOrThrow, rowsOrThrow } from "./rowOrThrow";

/**
 * The roster a game's results are credited through — the ONE answer every
 * finalize writer uses for "which team is this person on, for this game?"
 * (migration 203, PR 8a).
 *
 * ── Why the writers stopped reading `team_assignments` ────────────────────
 *
 * Ruling 15: standings stay with the unit credited at the time. Five writers
 * (stroke/scramble, skins, match play's awards, rack, pick'em) used to rebuild
 * their team rows from the CURRENT roster every time they ran, and a correction
 * re-runs them — so a player traded after a finished round, followed by a
 * one-hole correction, carried the whole round to their new team. The roster
 * lock was the only thing that made that unreachable, and PR 8 lifts it.
 *
 * So once a game has been finalized, its writers read the roster it was
 * credited through (`games.credited_roster`), never today's. Before that — a
 * first finalize, or a live recompute during play — they read today's roster,
 * because under ruling 15 a game's points are not earned until it finalizes.
 *
 * ── Absence is a fact here, not a gap ─────────────────────────────────────
 *
 * The map holds the whole cup roster at the first finalize. A person missing
 * from it was on no team THEN, and stays creditless on every re-finalize
 * (ruling 17). This function never "fills in" a missing person from today's
 * roster — that would be the bug this exists to remove.
 */

export interface CreditRosterRow {
  user_id: string;
  team_id: string;
}

export interface CreditRoster {
  /** Same shape the writers used to read from `team_assignments`. */
  rows: CreditRosterRow[];
  /** user_id -> team_id, for `writeGameResults` to record on a first finalize. */
  record: Record<string, string>;
  /** True when this is the roster the game was ALREADY credited through. */
  fromSnapshot: boolean;
}

/** Parse a stored roster, refusing anything that is not a string -> string map.
 *  A malformed snapshot fails closed: crediting through a half-read roster would
 *  pay the wrong team with no error anywhere. */
export function parseCreditedRoster(raw: unknown, gameId: string): Record<string, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Game ${gameId}'s credited roster is not a map, so its results can't be recomputed.`,
    });
  }
  const record: Record<string, string> = {};
  for (const [userId, teamId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof teamId !== "string" || teamId.length === 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Game ${gameId}'s credited roster has no team for a player, so its results can't be recomputed.`,
      });
    }
    record[userId] = teamId;
  }
  return record;
}

export async function readCreditRoster(
  supabase: SupabaseClient,
  gameId: string,
  competitionId: string
): Promise<CreditRoster> {
  const game = rowOrThrow(
    await supabase.from("games").select("credited_roster, trip_id").eq("id", gameId).maybeSingle(),
    { code: "NOT_FOUND", message: "Game not found" },
    "game's credited roster"
  );

  // NULL = never credited. `{}` is NOT that: it is a game credited with nobody
  // on a team, and it must stay that way rather than fall back to the roster.
  if (game.credited_roster !== null && game.credited_roster !== undefined) {
    const record = parseCreditedRoster(game.credited_roster, gameId);
    return {
      rows: Object.entries(record).map(([user_id, team_id]) => ({ user_id, team_id })),
      record,
      fromSnapshot: true,
    };
  }

  const assigns = rowsOrThrow(
    await supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
    "cup's rosters"
  );
  const rows = assigns.map((a) => ({ user_id: a.user_id as string, team_id: a.team_id as string }));
  const record: Record<string, string> = {};
  for (const r of rows) record[r.user_id] = r.team_id;

  for (const d of await departedTeams(supabase, game.trip_id as string, record)) {
    rows.push(d);
    record[d.user_id] = d.team_id;
  }
  return { rows, record, fromSnapshot: false };
}

/**
 * ── A departed person's team (migration 207, ruling 7) ─────────────────────
 *
 * A match decided before someone left is history: it keeps its seats, and it
 * pays the team they were on. Their assignment went with them, so the archive
 * records that team on their departure, and this is where it is read back —
 * ONE fallback in the ONE roster reader, so every writer gets it without a path
 * of its own.
 *
 * Only for the roster built from TODAY's assignments. A stored roster is never
 * touched: once a game has finalized it is authoritative, and anyone missing
 * from it was on no team then.
 *
 * Only for people who are NOT on the trip now. Someone who left and came back
 * is a member again, and their team is whatever today's roster says — on no
 * team if they have not been assigned since. The old record must not
 * resurrect a team they no longer hold. A person in today's roster is never
 * overridden either.
 *
 * Every read here fails closed (`rowsOrThrow`): a failed read is never data to
 * a writer, and these feed finalize.
 */
async function departedTeams(
  supabase: SupabaseClient,
  tripId: string,
  current: Record<string, string>
): Promise<CreditRosterRow[]> {

  // One cup per trip (`competitions_one_per_trip`), so a recorded team is this
  // cup's; a team deleted since is NULL (ON DELETE SET NULL) and skipped.
  const departed = rowsOrThrow(
    await supabase.from("trip_departures").select("user_id, team_id").eq("trip_id", tripId),
    "trip's departures"
  ).filter((d) => d.team_id != null && !(d.user_id in current));
  if (departed.length === 0) return [];

  const back = new Set(
    rowsOrThrow(
      await supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", tripId)
        .in("user_id", departed.map((d) => d.user_id as string)),
      "departed people still on the trip"
    ).map((m) => m.user_id as string)
  );

  return departed
    .filter((d) => !back.has(d.user_id as string))
    .map((d) => ({ user_id: d.user_id as string, team_id: d.team_id as string }));
}
