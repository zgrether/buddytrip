import type { SupabaseClient } from "@supabase/supabase-js";
import { rollUp, placementDetail, awardedForGame, type LiveGame } from "@/lib/competitionPlacement";
import { isPerMatch, isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { deriveMatchCount, type MatchFormat } from "@/lib/gameConfig";
import { isManualGameType } from "@/lib/gameTypes";
// isConfigured (+ the type sets) moved to gameReadiness.ts (A2-core) so the same
// "is it configured?" signal backs both this display AND the server enable guard.
import { isConfigured, MATCH_PLAY_TYPES } from "@/server/lib/gameReadiness";

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
 * The win number is DERIVED here from the competition's games, never stored.
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
      .select("defending_team_id, scoring_model")
      .eq("id", competitionId)
      .maybeSingle(),
    // Games of this competition — all feed the roll-up.
    supabase
      .from("games")
      .select("id, name, points_distribution, points_total, status, game_type_id, course_id, scoring_enabled")
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
  // Scoring-model axis (independent of team count; default match_play). Branches
  // ONLY the non-golf result award below — the hero stays on teams.length.
  const scoringModel = (comp?.scoring_model as string | null) ?? "match_play";
  // A NON-GOLF MANUAL game (result_strategy NULL) vs a golf game — sourced from
  // the format definitions in code (W-PERF-01), no longer a DB template fetch.
  // Only manual games get the match-play winner-take-all award; golf untouched.
  const isManualType = (typeId: string | null) => isManualGameType(typeId);
  const allGames = gameRowsRes.data ?? [];
  const sizeByTeam = new Map<string, number>();
  for (const a of assignmentsRes.data ?? []) {
    const tid = a.team_id as string;
    sizeByTeam.set(tid, (sizeByTeam.get(tid) ?? 0) + 1);
  }
  const teamSizes = teamIds.map((id) => sizeByTeam.get(id) ?? 0);

  const gameIds = allGames.map((g) => g.id as string);
  // game_results (awarded) + the per-game match COUNT (available) + the per-game
  // participant COUNT (the stroke/rack readiness gate). All depend on the live
  // game ids; run them together.
  const [resultsRes, matchRowsRes, participantRowsRes] = await Promise.all([
    gameIds.length
      ? supabase
          .from("game_results")
          .select("game_id, entity_id, position, raw_score")
          .in("game_id", gameIds)
          .eq("entity_type", "team")
      : Promise.resolve({ data: [] as { game_id: string; entity_id: string; position: number | null; raw_score: number | null }[] }),
    gameIds.length
      ? supabase.from("game_matches").select("game_id, side_a, side_b").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; side_a: unknown; side_b: unknown }[] }),
    gameIds.length
      ? supabase.from("game_participants").select("game_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string }[] }),
  ]);
  const results = resultsRes.data;
  // Participant rows per game — "field picked" (stroke) / "auto-grouped" (rack).
  const participantCountByGame = new Map<string, number>();
  for (const r of (participantRowsRes.data ?? []) as { game_id: string }[]) {
    participantCountByGame.set(r.game_id, (participantCountByGame.get(r.game_id) ?? 0) + 1);
  }
  // A match game's available points = value × the number of ASSIGNED matches
  // (both sides paired). "A match = assigned, everywhere" (round-3.1 addendum):
  // an unfilled slot is not a match — it never scores, so it contributes nothing
  // to points-in-play and doesn't make the game Ready. Empty slots are builder
  // scaffolding that the tee-off COLLAPSE discards; counting them here would show
  // a created-but-unpaired game phantom points. (Supersedes the earlier Slice-D
  // "configured rows incl. empty, ≥1 from creation" goalpost — pairing now moves
  // the live clinch target, by design.)
  const matchCountByGame = new Map<string, number>();
  // Total match ROWS (paired + the seeded/unpaired) per game — already in the
  // fetched data, no extra query. Feeds the readiness threshold: a match game is
  // configured only when EVERY row is paired (`paired === total`), the SAME bar
  // the setup-page Enable gate uses (`matchPlayReady`) — readiness rework P1b.
  const totalMatchRowsByGame = new Map<string, number>();
  for (const r of (matchRowsRes.data ?? []) as { game_id: string; side_a: unknown; side_b: unknown }[]) {
    totalMatchRowsByGame.set(r.game_id, (totalMatchRowsByGame.get(r.game_id) ?? 0) + 1);
    if (r.side_a == null || r.side_b == null) continue;
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

  const liveGames: LiveGame[] = allGames.map((g) => {
    const rawDist = g.points_distribution as PointsDistribution | null;
    const standings = standingsByGame.get(g.id as string) ?? [];

    // Match-play, non-golf MANUAL game → winner-take-all. The owner-set total all
    // goes to the winner (position 1); a tie (both at position 1) splits it —
    // placementPoints averages [P,0] → P/2 each, the same averaged convention a
    // golf match-play halve uses. Derived from points_total, NOT a configured
    // split, so the result is win/lose/tie regardless of any distribution values
    // on the record. Manual games only (result_strategy NULL) — golf untouched.
    if (scoringModel === "match_play" && isManualType(g.game_type_id as string | null)) {
      const total = (g.points_total as number | null) ?? 0;
      return {
        id: g.id as string,
        distribution: total > 0 ? [total, 0] : null,
        numTeams: teamIds.length,
        standings,
        direction: "low_wins" as const,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    if (isPerMatch(rawDist)) {
      const typeId = g.game_type_id as string | null;
      // Match play (singles/doubles): available = value × the game's ASSIGNED
      // match count (game_matches rows with both sides paired) — an unfilled slot
      // isn't a match, so it adds no points (round-3.1 "a match = assigned"). The
      // live clinch goalpost moves as matches get paired / added / removed. Other
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

  // Per-game points in play, keyed by id — the SAME per-game expression rollUp
  // sums into points-available (owner-set total, else the distribution sum). The
  // board row's outer column (§A5 `N PTS`) reads this so a match-play game —
  // whose `distribution` is null until decided — still shows its potential, AND
  // a distribution-only placement game (no owner total) shows its sum instead of
  // a bare `—`. Built from the computed liveGames so the row can't diverge from
  // the standings.
  const ptsInPlayByGame = new Map<string, number>(
    liveGames.map((g) => [g.id, g.pointsTotal ?? awardedForGame(g.distribution, g.numTeams)])
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
      const typeId = (g.game_type_id as string | null) ?? null;
      const hasPoints = !!rawDist || g.points_total != null;
      const gid = g.id as string;
      return {
        id: gid,
        name: (g.name as string | null) ?? "Game",
        distribution: isPlacement(rawDist) ? rawDist.values : null,
        status: g.status as string,
        gameTypeId: typeId,
        // "ready to score" = points are configured (a distribution shape or an
        // owner-set total). Kept for the games-panel/test consumers.
        ready: hasPoints,
        // The §A readiness gate: is the format's REQUIRED roster assigned? Drives
        // the Setting-up↔Ready transition AND the `N PTS`/`—` outer column from
        // ONE signal so they can't disagree (course/handicaps never gate this).
        configured: isConfigured(
          typeId,
          matchCountByGame.get(gid) ?? 0,
          totalMatchRowsByGame.get(gid) ?? 0,
          participantCountByGame.get(gid) ?? 0,
          hasPoints
        ),
        // Course presence (§ scorecard three-way) — surfaced so the row's
        // scorecard chip can be a real button (course set) vs a muted status
        // icon (no course). Course is optional and never an error.
        hasCourse: g.course_id != null,
        // Scoring enabled (Phase 2B.1) — the real arming signal the format-icon
        // color reads (§A4), replacing the Phase-3 derived stub.
        scoringEnabled: g.scoring_enabled === true,
        // Points in play (§A5 outer column). Match-play games carry it here even
        // though `distribution` is null pre-decision.
        pointsTotal: ptsInPlayByGame.get(gid) ?? null,
      };
    }),
    cells,
    pointsAvailable: roll.pointsAvailable,
    winNumber: roll.winNumber,
    teamTotals: Object.fromEntries(roll.teamTotals),
    pointsToClinch: Object.fromEntries(roll.pointsToClinch),
  };
}
