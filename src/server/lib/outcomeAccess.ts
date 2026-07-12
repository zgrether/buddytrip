import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditGame, type TripRole } from "@/server/middleware";
import { memberCanScoreUnit, type ScoreUnitMatch, type ScoreUnitSide } from "@/lib/scoreUnit";

/**
 * canWriteOutcome — the SERVER source of truth for "may this caller decide THIS
 * match's hole outcome?" (Refactor B3, the outcome-entry counterpart to
 * `canWriteScore`). Owner / co-admin / delegate-of-this-game → any match. A
 * plain member → only a match they're playing in, resolved by the SAME pure
 * `memberCanScoreUnit` the score path uses (its 1v1/2v2 match-membership
 * branches are exactly the outcome authorization rule — no new pure logic).
 *
 * Called by both `matchOutcomes.upsertOutcome` and `deleteOutcome` so no write
 * path is left on an elevated-only rule. Defense-in-depth: RLS on
 * `match_hole_outcomes` enforces the same rule via `can_score_match()` for
 * direct (non-tRPC) writes (mig 076 — lands in lockstep with this, since
 * `ctx.supabase` is RLS-enforcing, not service-role; a mismatched app-check/RLS
 * pair would be a broken half-permission state).
 */
type OutcomeCtx = {
  supabase: { from: (t: string) => unknown };
  user: { id: string } | null;
  membershipCache: Map<string, TripRole>;
};

export async function canWriteOutcome(
  ctx: OutcomeCtx,
  tripId: string,
  gameId: string,
  matchId: string,
): Promise<boolean> {
  // Owner / co-admin / delegate of THIS game → any match. Reuses the same
  // helper the rest of the game-edit surface uses, so the elevated tier can't
  // drift from the config/run gates.
  if (await canEditGame(ctx, tripId, gameId)) return true;

  const meId = ctx.user?.id;
  if (!meId) return false;

  const db = ctx.supabase as unknown as SupabaseClient;

  const { data: matchRow } = await db
    .from("game_matches")
    .select("side_a, side_b")
    .eq("id", matchId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (!matchRow) return false;
  const sideA = matchRow.side_a as ScoreUnitSide | null;
  const sideB = matchRow.side_b as ScoreUnitSide | null;
  if (!sideA?.id) return false; // an unpaired match has nothing to authorize against

  const matches: ScoreUnitMatch[] = [{ side_a: sideA, side_b: sideB }];

  const { data: meRow } = await db
    .from("game_participants")
    .select("play_group_id")
    .eq("game_id", gameId)
    .eq("user_id", meId)
    .maybeSingle();

  // memberCanScoreUnit resolves "is meId in the unit containing participantId" —
  // its 1v1/2v2 branches look at BOTH sides of the match once found, so passing
  // EITHER side's ref (here, side A's) as the "unit" resolves identically
  // regardless of which side the caller is actually on.
  return memberCanScoreUnit({
    meId,
    participantId: sideA.id,
    participantType: sideA.type as "user" | "play_group",
    matches,
    myPlayGroupId: (meRow as { play_group_id: string | null } | null)?.play_group_id ?? null,
    targetPlayGroupId: null,
    meIsParticipant: !!meRow,
  });
}
