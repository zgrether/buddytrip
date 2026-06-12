import type { SupabaseClient } from "@supabase/supabase-js";
import { rollUp, type LiveGame } from "@/lib/competitionPlacement";

/**
 * Server roll-up wrapper (Slice D1 §5/§6). The DB-read half of the CLAUDE.md #8
 * split: it gathers live games + team standings, then defers ALL math to the
 * client-safe pure `rollUp` — so the leaderboard the crew sees and any persisted
 * total can't diverge.
 *
 * Standings spine: every game_results row (entity_type 'team') carries a
 * `position` (1 = best) — engine games COMPUTE it, manual games have it ENTERED
 * (games.setManualResults). The roll-up never distinguishes the two. Direction is
 * low_wins on position. A Phase-1 shell (distribution set, no results yet) still
 * contributes points-available. `dropped` games are excluded here — which is why
 * dropping/restoring moves the win number (it's derived, never stored).
 */
export async function computeCompetitionLeaderboard(
  supabase: SupabaseClient,
  competitionId: string
) {
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name, color")
    .eq("competition_id", competitionId);
  const teamIds = (teams ?? []).map((t) => t.id as string);

  const { data: comp } = await supabase
    .from("competitions")
    .select("defending_team_id")
    .eq("id", competitionId)
    .maybeSingle();

  // Live (non-dropped) competition games only.
  const { data: gameRows } = await supabase
    .from("games")
    .select("id, points_distribution, status")
    .eq("competition_id", competitionId)
    .neq("status", "dropped");
  const live = gameRows ?? [];

  const gameIds = live.map((g) => g.id as string);
  const { data: results } = gameIds.length
    ? await supabase
        .from("game_results")
        .select("game_id, entity_id, position, raw_score")
        .in("game_id", gameIds)
        .eq("entity_type", "team")
    : { data: [] as { game_id: string; entity_id: string; position: number | null; raw_score: number | null }[] };

  const standingsByGame = new Map<string, { entityId: string; value: number }[]>();
  for (const r of results ?? []) {
    const arr = standingsByGame.get(r.game_id as string) ?? [];
    arr.push({ entityId: r.entity_id as string, value: (r.position ?? r.raw_score ?? 0) as number });
    standingsByGame.set(r.game_id as string, arr);
  }

  const liveGames: LiveGame[] = live.map((g) => ({
    id: g.id as string,
    distribution: (g.points_distribution as number[] | null) ?? null,
    numTeams: teamIds.length,
    standings: standingsByGame.get(g.id as string) ?? [],
    direction: "low_wins", // standing = position (1 = best)
  }));

  const roll = rollUp(liveGames, teamIds, { defendingTeamId: comp?.defending_team_id ?? null });

  return {
    teams: teams ?? [],
    pointsAvailable: roll.pointsAvailable,
    winNumber: roll.winNumber,
    teamTotals: Object.fromEntries(roll.teamTotals),
    pointsToClinch: Object.fromEntries(roll.pointsToClinch),
  };
}
