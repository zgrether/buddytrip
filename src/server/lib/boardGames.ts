import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "@/server/lib/rowOrThrow";
import { isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { isBracketGame } from "@/lib/resultStrategy";
import { isConfigured, isNew, ROSTER_TYPES } from "@/server/lib/gameReadiness";

/**
 * ONE derivation of a game's board row — its lifecycle section, readiness and
 * arming — for every surface that lists games (PR 6b).
 *
 * Extracted from `computeCompetitionLeaderboard`, which built it inline for a
 * competition's games. The games page now also lists SIDE games (no
 * competition), in the same lifecycle sections, and a second copy of this
 * mapping is exactly how "Ready" would come to mean two things (CLAUDE.md #8:
 * reuse the pure fn, never write a second rollup). So the reads and the mapping
 * live here, and both callers use them:
 *
 *  - `computeCompetitionLeaderboard` — the cup's games, with its team rollups
 *    reading the same count maps;
 *  - `sideBoard` — a trip's games with no competition.
 *
 * Nothing about a row depends on WHICH container holds the game, which is what
 * makes one builder correct for both.
 */

export interface BoardInputs {
  participantCountByGame: Map<string, number>;
  /** Participants in a play group — stroke/rack/scramble/skins readiness (089). */
  groupedParticipantCountByGame: Map<string, number>;
  /** ASSIGNED matches (both sides paired) — "a match = assigned, everywhere". */
  matchCountByGame: Map<string, number>;
  /** Every match row, paired or not — the readiness bar is paired === total. */
  totalMatchRowsByGame: Map<string, number>;
  /** Seeded bracket entrants — a configuration act, so it feeds `isNew`. */
  entrantCountByGame: Map<string, number>;
  /** Games that have begun producing results (`game_started`, migration 161). */
  startedByGame: Set<string>;
}

type GameRow = Record<string, unknown> & { id: unknown; game_type_id: unknown; competition_format?: unknown };

/**
 * The four child reads a board row needs, for `games`. Every read succeeds or
 * throws (the `rowOrThrow` family, #1468): a failed read here would render a
 * configured game as New, or a live game as Ready, and the leaderboard's clinch
 * writers act on the same counts.
 *
 * `owner` is the noun's owner in the failure sentence — "cup's" for the
 * leaderboard (whose sentences #1468's tests pin exactly) and "trip's" for the
 * side board.
 */
export async function readBoardInputs(
  supabase: SupabaseClient,
  games: GameRow[],
  owner: "cup's" | "trip's"
): Promise<BoardInputs> {
  const gameIds = games.map((g) => g.id as string);
  // A game's bracket-ness is resolved the way `games.finish` resolves it, so the
  // entrant read (skipped entirely when there is no bracket) and the write path
  // cannot disagree about which games are brackets.
  const bracketGameIds = games
    .filter((g) => isBracketGame(g.game_type_id as string | null, (g.competition_format as string | null) ?? null))
    .map((g) => g.id as string);

  const [matchRowsRes, participantRowsRes, startedRowsRes, entrantRowsRes] = await Promise.all([
    gameIds.length
      ? supabase.from("game_matches").select("game_id, side_a, side_b").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; side_a: unknown; side_b: unknown }[], error: null }),
    gameIds.length
      ? supabase.from("game_participants").select("game_id, play_group_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; play_group_id: string | null }[], error: null }),
    // Has it begun producing results? ONE read of `game_started` (migration
    // 161): the view carries every format's arm, so a new format adds an arm
    // there rather than a query here.
    gameIds.length
      ? supabase.from("game_started").select("game_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string }[], error: null }),
    bracketGameIds.length
      // `team_id` is left in the select so the shape still matches `bracketPool`.
      ? supabase.from("bracket_entrants").select("id, game_id, team_id").in("game_id", bracketGameIds)
      : Promise.resolve({ data: [] as { id: string; game_id: string; team_id: string | null }[], error: null }),
  ]);

  const entrantCountByGame = new Map<string, number>();
  for (const e of rowsOrThrow(entrantRowsRes, `${owner} bracket entrants`) as { game_id: string }[]) {
    entrantCountByGame.set(e.game_id, (entrantCountByGame.get(e.game_id) ?? 0) + 1);
  }
  const startedByGame = new Set<string>(
    (rowsOrThrow(startedRowsRes, `${owner} started games`) as { game_id: string }[]).map((r) => r.game_id)
  );
  // Rack readiness needs players in a playing group, so the GROUPED count is
  // tracked separately — the same bar the server enable guard uses.
  const participantCountByGame = new Map<string, number>();
  const groupedParticipantCountByGame = new Map<string, number>();
  for (const r of rowsOrThrow(participantRowsRes, `${owner} participants`) as { game_id: string; play_group_id: string | null }[]) {
    participantCountByGame.set(r.game_id, (participantCountByGame.get(r.game_id) ?? 0) + 1);
    if (r.play_group_id != null) {
      groupedParticipantCountByGame.set(r.game_id, (groupedParticipantCountByGame.get(r.game_id) ?? 0) + 1);
    }
  }
  // An unfilled slot is builder scaffolding, not a match: it never scores and
  // doesn't make the game Ready, so only BOTH-sides-paired rows count here.
  const matchCountByGame = new Map<string, number>();
  const totalMatchRowsByGame = new Map<string, number>();
  for (const r of rowsOrThrow(matchRowsRes, `${owner} matches`) as { game_id: string; side_a: unknown; side_b: unknown }[]) {
    totalMatchRowsByGame.set(r.game_id, (totalMatchRowsByGame.get(r.game_id) ?? 0) + 1);
    if (r.side_a == null || r.side_b == null) continue;
    matchCountByGame.set(r.game_id, (matchCountByGame.get(r.game_id) ?? 0) + 1);
  }

  return {
    participantCountByGame,
    groupedParticipantCountByGame,
    matchCountByGame,
    totalMatchRowsByGame,
    entrantCountByGame,
    startedByGame,
  };
}

/**
 * One game's board row. Pure: everything it needs is in `g`, `inputs` and
 * `pointsTotal` (the leaderboard's points-in-play; a side game has none).
 */
export function boardRow(g: GameRow, inputs: BoardInputs, pointsTotal: number | null) {
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
    // the Setting-up↔Ready transition AND the `N PTS`/`—` outer column from ONE
    // signal so they can't disagree (course/handicaps never gate this).
    configured: isConfigured(
      typeId,
      inputs.matchCountByGame.get(gid) ?? 0,
      inputs.totalMatchRowsByGame.get(gid) ?? 0,
      // Stroke + rack both gate on GROUPED players (mandatory groupings, 089).
      ((typeId && ROSTER_TYPES.has(typeId)) ? inputs.groupedParticipantCountByGame : inputs.participantCountByGame).get(gid) ?? 0,
      hasPoints,
      (g.competition_format as string | null) ?? null
    ),
    /**
     * NEW — nothing configured yet, only what the add-game modal wrote. A
     * separate, earlier question than `configured`. The child-row count is
     * participants + match rows + bracket entrants; play groups and bracket
     * matches are covered transitively (`gameNewState.test.ts` pins each).
     */
    isNewGame: isNew(g, (
      (inputs.participantCountByGame.get(gid) ?? 0) +
      (inputs.totalMatchRowsByGame.get(gid) ?? 0) +
      (inputs.entrantCountByGame.get(gid) ?? 0)
    )),
    // Course presence — the scorecard chip is a button with a course, a muted
    // status icon without one. Course is optional and never an error.
    hasCourse: g.course_id != null,
    // Scoring enabled (Phase 2B.1) — the arming signal the format icon reads.
    scoringEnabled: g.scoring_enabled === true,
    // Has begun producing results — splits `active` into Live vs Ready.
    started: inputs.startedByGame.has(gid),
    // Re-opened for a score correction; only meaningful once `status` is
    // "complete". Not role-gated: members correct their own scores in it.
    correctionsOpen: g.corrections_open === true,
    // Points in play (§A5 outer column).
    pointsTotal,
    // The trip's ONE game order (PR 6b) — what lets the games page merge the
    // cup's games and side games into one sequence.
    displayOrder: (g.display_order as number | null) ?? null,
  };
}

export type BoardGameRow = ReturnType<typeof boardRow>;
