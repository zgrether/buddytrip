import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditGame, type TripRole } from "@/server/middleware";

/**
 * canWriteSkinsHole — the SERVER source of truth for "may this caller record
 * THIS grouping's hole?"
 *
 * Owner / co-admin / delegate-of-this-game → any grouping. A plain member → only
 * a grouping they are in.
 *
 * ── Why this is not `canWriteOutcome` with another branch ─────────────────
 *
 * That function answers a MATCH question and resolves through
 * `memberCanScoreUnit`, whose 1v1 / 2v2 branches are about the two sides of a
 * `game_matches` row. Skins has no matches and no sides — the unit of
 * authorization is the grouping, membership of it is a single column
 * (`game_participants.play_group_id`), and there is no second side to also
 * admit. Reusing the match rule would mean teaching it about a shape it has no
 * concept of, which is CLAUDE.md #24 pointed the wrong way.
 *
 * Defense-in-depth: RLS on `skins_hole_outcomes` enforces the SAME rule via
 * `can_score_skins_grouping()` for direct (non-tRPC) writes, and the two land in
 * lockstep — `ctx.supabase` is RLS-enforcing rather than service-role, so an
 * app-check without the matching policy would pass the check and then fail the
 * write.
 *
 * The `scoring_enabled` half of the policy is NOT repeated here: both callers
 * refuse a scoring-disabled game before they reach this, with a message that
 * says so. Duplicating it would give the same condition two sentences.
 */
type SkinsCtx = {
  supabase: { from: (t: string) => unknown };
  user: { id: string } | null;
  membershipCache: Map<string, TripRole>;
};

export async function canWriteSkinsHole(
  ctx: SkinsCtx,
  tripId: string,
  gameId: string,
  groupingId: string
): Promise<boolean> {
  if (await canEditGame(ctx, tripId, gameId)) return true;

  const meId = ctx.user?.id;
  if (!meId) return false;

  const db = ctx.supabase as unknown as SupabaseClient;

  // The grouping must belong to THIS game, or a caller could name one of their
  // own groupings from another game and be admitted into a game they are not in.
  const { data: grouping } = await db
    .from("play_groups")
    .select("id")
    .eq("id", groupingId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (!grouping) return false;

  const { data: me } = await db
    .from("game_participants")
    .select("play_group_id")
    .eq("game_id", gameId)
    .eq("user_id", meId)
    .maybeSingle();

  return (me as { play_group_id: string | null } | null)?.play_group_id === groupingId;
}
