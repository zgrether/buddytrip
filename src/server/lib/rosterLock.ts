import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

/**
 * Roster-removal lock (team-identity integrity). Once the first score is entered
 * in ANY game of a competition, that competition's rosters freeze for REMOVALS —
 * removing a player, trading/moving them, or deleting a team. ADDS stay allowed
 * (an add can't orphan anyone in an existing match). Prevention replaces the
 * earlier flip-to-setup recovery: a removal can't invalidate a live game if the
 * removal is blocked once scoring starts.
 *
 * The "scored" signal is `score_entries` existence — the SAME boundary
 * `applyCourse` freezes the course snapshot on, not a parallel invention.
 */

/** Has ANY game in this competition recorded a score yet? (first-score signal) */
export async function competitionHasScore(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<boolean> {
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("competition_id", competitionId);
  const ids = (games ?? []).map((g) => g.id as string);
  if (ids.length === 0) return false;
  const { count } = await supabase
    .from("score_entries")
    .select("id", { count: "exact", head: true })
    .in("game_id", ids);
  return (count ?? 0) > 0;
}

export const ROSTER_LOCKED_MESSAGE =
  "Scoring has started — team rosters are locked. You can still add players, but can't remove or move them.";

/**
 * Throw if the competition is roster-locked (any score entered). Call BEFORE a
 * removal/trade/team-delete write; never call it on a pure add (adds are always
 * allowed).
 */
export async function assertRosterUnlocked(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<void> {
  if (await competitionHasScore(supabase, competitionId)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: ROSTER_LOCKED_MESSAGE });
  }
}
