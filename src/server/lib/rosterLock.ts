import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { anyGameStarted } from "./gameStarted";

/**
 * Roster-removal lock (team-identity integrity). Once the first RESULT lands in
 * ANY game of a competition, that competition's rosters freeze for REMOVALS —
 * removing a player, trading/moving them, or deleting a team. ADDS stay allowed
 * (an add can't orphan anyone in an existing match). Prevention replaces the
 * earlier flip-to-setup recovery: a removal can't invalidate a live game if the
 * removal is blocked once scoring starts.
 *
 * ── The signal was `score_entries` and that was wrong for three formats ────
 *
 * It used to count `score_entries` rows directly, described here as "the SAME
 * boundary `applyCourse` freezes the course snapshot on, not a parallel
 * invention". The reuse was real; the table was not the boundary. Three formats
 * write no `score_entries` at all — outcome-mode match play
 * (`match_hole_outcomes`), pick'em (`pickem_slate_games.result`), and non-golf
 * Matches (a declared `game_matches.result`) — so this unlocked the rosters of
 * a competition whose games were well underway (#1018).
 *
 * `game_started` is the boundary with every format's arm in it, and taking it
 * from there means the next format is covered without this file being touched.
 * See `gameStarted.ts` for why the predicate is shared rather than copied.
 *
 * ── This guard is COMPETITION-scoped, so it needs no membership question ───
 *
 * Its sibling `findContributionBlockers` had TWO gaps for pick'em: it could not
 * see that the game had started, and it could not see that the person was IN
 * it. Only the first applies here — this function takes no user id and asks
 * nothing about one. "Has anything in this cup begun?" is answered by the view
 * alone.
 */

/** Has ANY game in this competition begun producing results? */
export async function competitionHasScore(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<boolean> {
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("competition_id", competitionId);
  const ids = (games ?? []).map((g) => g.id as string);
  return anyGameStarted(supabase, ids);
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
