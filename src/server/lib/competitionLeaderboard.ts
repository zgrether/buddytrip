import type { SupabaseClient } from "@supabase/supabase-js";
import { rollUp, placementDetail, type LiveGame } from "@/lib/competitionPlacement";
import { isPerMatch, isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { deriveMatchCount, type MatchFormat } from "@/lib/gameConfig";

/** Singles vs doubles for matchCount. Only singles match play exists today; a
 *  future doubles type slots in here without touching the caller. */
function matchFormat(gameTypeId: string | null): MatchFormat {
  return gameTypeId === "gtt_match_play_doubles" ? "doubles" : "singles";
}

/**
 * Server roll-up wrapper (Slice D1 §5/§6). The DB-read half of the CLAUDE.md #8
 * split: it gathers live games + team standings, then defers ALL math to the
 * client-safe pure `rollUp` — so the leaderboard the crew sees and any persisted
 * total can't diverge.
 *
 * Standings spine:
 *  - placement games: game_results entity_type='team', position=rank (1=best),
 *    direction low_wins. Distribution values are the ranked payout array.
 *  - per_match games: game_results entity_type='team', raw_score=match points
 *    (written by the adapter in computeMatchPlayResults). No position. We build a
 *    SYNTHETIC distribution (sorted actual points) so rollUp's placementPoints
 *    passes the values through directly (direction high_wins).
 *
 * `dropped` games are excluded from the roll-up — which is why
 * dropping/restoring a game recomputes the win number (§4): it is derived here,
 * never stored.
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

  // Games of this competition. We fetch ALL (incl. dropped) so the grid can show
  // an "Abandoned" column, but only LIVE ones feed the roll-up / points-available.
  const { data: gameRows } = await supabase
    .from("games")
    .select("id, name, points_distribution, points_total, status, game_type_id")
    .eq("competition_id", competitionId)
    .order("created_at", { ascending: true });
  const allGames = gameRows ?? [];
  const live = allGames.filter((g) => g.status !== "dropped");

  // Team sizes (member headcount) drive the match-game total = value ×
  // matchCount — derived from sizes, NOT pairings, so the per_match total is
  // known once teams are populated and stays stable through the week (§8).
  const { data: assignments } = await supabase
    .from("team_assignments")
    .select("team_id")
    .eq("competition_id", competitionId);
  const sizeByTeam = new Map<string, number>();
  for (const a of assignments ?? []) {
    const tid = a.team_id as string;
    sizeByTeam.set(tid, (sizeByTeam.get(tid) ?? 0) + 1);
  }
  const teamSizes = teamIds.map((id) => sizeByTeam.get(id) ?? 0);

  const gameIds = live.map((g) => g.id as string);
  const { data: results } = gameIds.length
    ? await supabase
        .from("game_results")
        .select("game_id, entity_id, position, raw_score")
        .in("game_id", gameIds)
        .eq("entity_type", "team")
    : { data: [] as { game_id: string; entity_id: string; position: number | null; raw_score: number | null }[] };

  // For placement games: value = position (lower wins).
  // For per_match games: value = raw_score (match points, higher wins).
  const standingsByGame = new Map<string, { entityId: string; value: number }[]>();
  for (const r of results ?? []) {
    const arr = standingsByGame.get(r.game_id as string) ?? [];
    arr.push({ entityId: r.entity_id as string, value: (r.position ?? r.raw_score ?? 0) as number });
    standingsByGame.set(r.game_id as string, arr);
  }

  const liveGames: LiveGame[] = live.map((g) => {
    const rawDist = g.points_distribution as PointsDistribution | null;
    const standings = standingsByGame.get(g.id as string) ?? [];

    if (isPerMatch(rawDist)) {
      // Available (stable): value × matchCount from TEAM SIZES — known before
      // pairings, so the clinch number doesn't move as matches are played (§8).
      // 0 when teams aren't sized yet ("matches not set"). AWARDED teamTotals
      // still come from the realized per-team match points (synthetic
      // distribution below), so configuring/playing moves only awarded points.
      const mc = deriveMatchCount(teamSizes, matchFormat(g.game_type_id as string | null));
      const pointsTotal = mc != null ? rawDist.value * mc : 0;
      if (standings.length === 0) {
        // No decided matches yet — contributes its available pool, no awards.
        return { id: g.id as string, distribution: null, numTeams: teamIds.length, standings: [], direction: "high_wins" as const, pointsTotal };
      }
      const sorted = [...standings].sort((a, b) => b.value - a.value);
      return {
        id: g.id as string,
        distribution: sorted.map((s) => s.value),
        numTeams: teamIds.length,
        standings: sorted,
        direction: "high_wins" as const,
        pointsTotal,
      };
    }

    if (isPlacement(rawDist)) {
      // Available uses the owner-set total (counts even before distribution —
      // stable clinch). A legacy game with no total (null) falls back to the
      // distribution sum via rollUp's awardedForGame.
      return {
        id: g.id as string,
        distribution: rawDist.values,
        numTeams: teamIds.length,
        standings,
        direction: "low_wins" as const,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    // null / unknown distribution shape: an undistributed placement SHELL still
    // contributes its owner-set total (the Game-tab value saved before the
    // Configuration-tab split exists). No total → contributes nothing.
    return {
      id: g.id as string,
      distribution: null,
      numTeams: teamIds.length,
      standings: [],
      direction: "low_wins" as const,
      pointsTotal: (g.points_total as number | null) ?? undefined,
    };
  });

  const roll = rollUp(liveGames, teamIds, { defendingTeamId: comp?.defending_team_id ?? null });

  // Per-game grid cells (place + points per team) — same averaging as the totals,
  // so the grid and the totals can't disagree. Only live games carry cells.
  const cells: { gameId: string; teamId: string; place: number; points: number }[] = [];
  for (const g of liveGames) {
    if (!g.distribution || g.standings.length === 0) continue;
    const detail = placementDetail(g.distribution, g.standings, g.direction);
    for (const [teamId, d] of detail) {
      cells.push({ gameId: g.id, teamId, place: d.place, points: d.points });
    }
  }

  return {
    teams: teams ?? [],
    defendingTeamId: (comp?.defending_team_id as string | null) ?? null,
    games: allGames.map((g) => {
      const rawDist = g.points_distribution as PointsDistribution | null;
      return {
        id: g.id as string,
        name: (g.name as string | null) ?? "Game",
        distribution: isPlacement(rawDist) ? rawDist.values : null,
        status: g.status as string,
        dropped: g.status === "dropped",
        gameTypeId: (g.game_type_id as string | null) ?? null,
        // "ready to score" = points are configured (a distribution shape or an
        // owner-set total). Drives the state-aware leaderboard rows: an unready
        // game reads "not scoring yet" instead of an empty/0–0 line (§7).
        ready: !!rawDist || g.points_total != null,
      };
    }),
    cells,
    pointsAvailable: roll.pointsAvailable,
    winNumber: roll.winNumber,
    teamTotals: Object.fromEntries(roll.teamTotals),
    pointsToClinch: Object.fromEntries(roll.pointsToClinch),
  };
}
