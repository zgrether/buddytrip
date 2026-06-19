import type { SupabaseClient } from "@supabase/supabase-js";
import { rollUp, placementDetail, type LiveGame } from "@/lib/competitionPlacement";
import { isPerMatch, isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { deriveMatchCount, type MatchFormat } from "@/lib/gameConfig";

const MATCH_PLAY_TYPES = new Set(["gtt_match_play_singles", "gtt_match_play_doubles"]);

/** Singles vs doubles head-to-head sizing for the team-size-derived formats
 *  (rack-n-stack). Match play itself counts its configured rows instead. */
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
  // These reads are independent — run them in parallel (one round-trip's worth
  // of latency instead of stacked). `game_results` + the match counts alone
  // depend on the game ids, so they wait below.
  const [teamsRes, compRes, gameRowsRes, assignmentsRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name, color")
      .eq("competition_id", competitionId),
    supabase
      .from("competitions")
      .select("defending_team_id")
      .eq("id", competitionId)
      .maybeSingle(),
    // Games of this competition. We fetch ALL (incl. dropped) so the grid can
    // show an "Abandoned" column, but only LIVE ones feed the roll-up.
    supabase
      .from("games")
      .select("id, name, points_distribution, points_total, status, game_type_id")
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: true }),
    // Team sizes drive the team-size-derived per_match formats (rack-n-stack):
    // value × min team size. Match play instead counts its configured rows.
    supabase
      .from("team_assignments")
      .select("team_id")
      .eq("competition_id", competitionId),
  ]);
  const teams = teamsRes.data;
  const teamIds = (teams ?? []).map((t) => t.id as string);
  const comp = compRes.data;
  const allGames = gameRowsRes.data ?? [];
  const live = allGames.filter((g) => g.status !== "dropped");
  const sizeByTeam = new Map<string, number>();
  for (const a of assignmentsRes.data ?? []) {
    const tid = a.team_id as string;
    sizeByTeam.set(tid, (sizeByTeam.get(tid) ?? 0) + 1);
  }
  const teamSizes = teamIds.map((id) => sizeByTeam.get(id) ?? 0);

  const gameIds = live.map((g) => g.id as string);
  // game_results (awarded) + the per-game match COUNT (available). Both depend on
  // the live game ids; run them together.
  const [resultsRes, matchRowsRes] = await Promise.all([
    gameIds.length
      ? supabase
          .from("game_results")
          .select("game_id, entity_id, position, raw_score")
          .in("game_id", gameIds)
          .eq("entity_type", "team")
      : Promise.resolve({ data: [] as { game_id: string; entity_id: string; position: number | null; raw_score: number | null }[] }),
    gameIds.length
      ? supabase.from("game_matches").select("game_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string }[] }),
  ]);
  const results = resultsRes.data;
  // A match game's available points = value × the number of matches it is
  // CONFIGURED to have (its game_matches rows), counted regardless of whether
  // they're paired yet — the configured count, ≥1 from creation. Adding/removing
  // a match moves this (the live clinch target); pairing or playing does not.
  // (Was value × deriveMatchCount(teamSizes) — the stable §8 estimate; the
  // dynamic-match-count build moves the goalpost to the live configured count.)
  const matchCountByGame = new Map<string, number>();
  for (const r of (matchRowsRes.data ?? []) as { game_id: string }[]) {
    matchCountByGame.set(r.game_id, (matchCountByGame.get(r.game_id) ?? 0) + 1);
  }

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
      const typeId = g.game_type_id as string | null;
      // Match play (singles/doubles): available = value × the game's CONFIGURED
      // match count (its game_matches rows), regardless of pairing — the live
      // clinch goalpost that add/remove moves (dynamic match count). Other
      // per_match formats (rack-n-stack) DON'T use game_matches; their count is
      // the team-size-derived head-to-head sizing (unchanged stable model) — so
      // counting rows there would zero them out.
      const mc =
        typeId && MATCH_PLAY_TYPES.has(typeId)
          ? matchCountByGame.get(g.id as string) ?? 0
          : deriveMatchCount(teamSizes, matchFormat(typeId)) ?? 0;
      const pointsTotal = rawDist.value * mc;
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

  // Per-game points in play, keyed by id — the SAME authoritative value the
  // roll-up uses (owner-set total for placement; value × match count for
  // per_match). The board row's outer column (§A5 `N PTS`) reads this so a
  // match-play game — whose `distribution` is null until decided — still shows
  // its potential. Built from the computed liveGames so the row can't diverge
  // from the standings.
  const ptsInPlayByGame = new Map<string, number | null>(
    liveGames.map((g) => [g.id, g.pointsTotal ?? null])
  );

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
        // Points in play (§A5 outer column). Match-play games carry it here even
        // though `distribution` is null pre-decision; dropped games (not in the
        // roll-up) get null and the row never renders them anyway.
        pointsTotal: ptsInPlayByGame.get(g.id as string) ?? null,
      };
    }),
    cells,
    pointsAvailable: roll.pointsAvailable,
    winNumber: roll.winNumber,
    teamTotals: Object.fromEntries(roll.teamTotals),
    pointsToClinch: Object.fromEntries(roll.pointsToClinch),
  };
}
