import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { matchPlayReady } from "@/lib/matchDraft";

/**
 * Game readiness — the ONE "is this game configured enough to score?" signal,
 * shared (A2-core) by the competition leaderboard's Setting-up↔Ready display AND
 * the server-side enable guard (`assertGameReady`). Lifted out of
 * competitionLeaderboard.ts so the mode toggle's Setup→Scoring flip is refused
 * server-side for an under-configured game, for ALL three formats — not just the
 * client gate match play had. The format's REQUIRED roster is the bar; course +
 * handicaps are optional and NEVER gate readiness.
 */

// One unified match-play type (Refactor A1) — 1v1/2v2/mixed is per-match, not a
// game type. A Set is kept (rather than an equality) so any future match-play
// variant slots in without touching call sites.
export const MATCH_PLAY_TYPES = new Set(["gtt_match_play"]);
export const RACK_TYPE = "gtt_rack_n_stack";
// Roster-gated golf formats: both stroke and rack are "configured" once they have
// participants assigned to a PLAYING GROUP (the manual group builder). Groupings are
// MANDATORY for both (089) — an ungrouped player isn't in the game — so the caller
// passes the GROUPED participant count (see the grouped-count branch below).
export const ROSTER_TYPES = new Set(["gtt_stroke_play", RACK_TYPE]);

/**
 * Is the game configured enough to be Ready (vs still Setting up)?
 *  - match play → ALL pairings assigned (`matchPlayReady`: paired === total, ≥1) —
 *    the SAME threshold the setup-page Enable gate uses, so list-ready ⟺
 *    setup-can-enable (readiness rework P1b).
 *  - stroke / rack → participants assigned to a PLAYING GROUP (the manual group
 *    builder); groupings are MANDATORY for both (089), so the caller passes the
 *    GROUPED participant count — ungrouped players (not in the game) don't read as ready
 *  - manual / side events → points configured (no roster to assign)
 */
export function isConfigured(
  typeId: string | null,
  matchPaired: number,
  matchTotal: number,
  participantCount: number,
  hasPoints: boolean
): boolean {
  if (typeId && MATCH_PLAY_TYPES.has(typeId)) return matchPlayReady(matchPaired, matchTotal);
  if (typeId && ROSTER_TYPES.has(typeId)) return participantCount > 0;
  return hasPoints;
}

/**
 * Server-side enable guard (A2-core, decision 4). Throws PRECONDITION_FAILED if the
 * game isn't configured enough to switch to scoring. The client toggle is gated too
 * (UX), but THIS is the enforcement — and it covers stroke/rack/manual, which had no
 * client gate at all. Reads the same inputs the leaderboard derives `configured` from.
 */
export async function assertGameReady(supabase: SupabaseClient, gameId: string): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("game_type_id, points_distribution, points_total")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

  const typeId = (game.game_type_id as string | null) ?? null;
  const hasPoints = game.points_distribution != null || game.points_total != null;
  let matchPaired = 0;
  let matchTotal = 0;
  let participantCount = 0;

  if (typeId && MATCH_PLAY_TYPES.has(typeId)) {
    const { data: rows } = await supabase
      .from("game_matches")
      .select("side_a, side_b")
      .eq("game_id", gameId);
    const matches = (rows ?? []) as { side_a: { id?: string } | null; side_b: { id?: string } | null }[];
    matchTotal = matches.length;
    matchPaired = matches.filter((m) => m.side_a?.id && m.side_b?.id).length;
  } else if (typeId && ROSTER_TYPES.has(typeId)) {
    let query = supabase
      .from("game_participants")
      .select("user_id", { count: "exact", head: true })
      .eq("game_id", gameId);
    // Both stroke and rack require players actually GROUPED (the manual group builder) —
    // a bare roster with no playing groups isn't ready (mandatory groupings, 089).
    query = query.not("play_group_id", "is", null);
    const { count } = await query;
    participantCount = count ?? 0;
  }

  if (!isConfigured(typeId, matchPaired, matchTotal, participantCount, hasPoints)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Finish setting up this game before switching it to scoring.",
    });
  }
}
