import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "./rowOrThrow";

/**
 * Which games a person is in — one reader, shared by every caller that asks.
 *
 * This file was `participationGuard.ts`, home of the "don't destroy history
 * by removing a person" guard (`findContributionBlockers`, #951/#997/#1016),
 * which refused removing anyone with a result or score. PR 8d made removal an
 * ARCHIVE that keeps history, so the guard stopped refusing (ruling 2), and PR
 * 8d-3 retired it: the remove and leave sheets show only an expense count
 * (`tripMembers.departureSummary`), and what counts as history is decided ONCE,
 * in the database (`archive_trip_member` / `_trip_history_names`). A second
 * copy of that decision on the server would be two deciders for one question.
 */

/** Which of a set of games one person is IN, and every id their side is
 *  recorded under. The single answer to that question (CLAUDE.md #27), shared by
 *  the roster-change refusal (`rosterChange.ts`) and re-credit (`recredit.ts`).
 *
 *  - `gameIds`: a `game_participants` row, or a pick'em sheet. A sheet is the
 *    participation for points-mode and unpaired pick'em, which have no
 *    participant row (#1151). A ROW IS A PICK: `pickem_picks.pick` is NOT NULL
 *    and nothing seeds a row per participant (migrations 146, 166).
 *  - `sideIds`: the person, plus any doubles `play_group` they belong to —
 *    `game_participants.play_group_id` is what `setPairings`' `mkSide` writes,
 *    so it is the only link from a person to their 2v2 side's id (#1016).
 *  - `entrantIds` / `entrantGameIds`: bracket entrants they are a member of,
 *    and the games those entrants are drawn into. Kept SEPARATE from `gameIds`:
 *    to a roster change an entrant in an unfinished bracket is in that game,
 *    while a caller asking about seats or results may treat a draw as a plan.
 *
 *  Reads through the rowOrThrow family: a failed read throws rather than
 *  answering "in no games", which would open the guards that read it. */
export interface PersonParticipation {
  gameIds: Set<string>;
  sideIds: Set<string>;
  entrantIds: string[];
  entrantGameIds: Set<string>;
}

export async function readPersonParticipation(
  supabase: SupabaseClient,
  gameIds: string[],
  userId: string
): Promise<PersonParticipation> {
  const out: PersonParticipation = {
    gameIds: new Set(), sideIds: new Set([userId]), entrantIds: [], entrantGameIds: new Set(),
  };
  if (gameIds.length === 0) return out;
  const [parts, sheets, entrants] = await Promise.all([
    supabase.from("game_participants").select("game_id, play_group_id").eq("user_id", userId).in("game_id", gameIds),
    supabase.from("pickem_picks").select("game_id").eq("user_id", userId).in("game_id", gameIds),
    supabase.from("bracket_entrant_members").select("entrant_id").eq("user_id", userId),
  ]);
  for (const r of rowsOrThrow(parts, "game participants")) {
    out.gameIds.add(r.game_id as string);
    const pg = r.play_group_id as string | null;
    if (pg) out.sideIds.add(pg);
  }
  for (const r of rowsOrThrow(sheets, "pick'em sheets")) out.gameIds.add(r.game_id as string);
  out.entrantIds = rowsOrThrow(entrants, "bracket entrants").map((r) => r.entrant_id as string);
  if (out.entrantIds.length > 0) {
    const games = rowsOrThrow(
      await supabase.from("bracket_entrants").select("game_id").in("id", out.entrantIds).in("game_id", gameIds),
      "bracket entrants' games"
    );
    for (const r of games) out.entrantGameIds.add(r.game_id as string);
  }
  return out;
}
