import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "@/server/lib/rowOrThrow";
import { isPlacement, type PointsDistribution } from "@/lib/pointsDistribution";
import { isBracketGame } from "@/lib/resultStrategy";
import { hasPositivePoints, isNew } from "@/server/lib/gameReadiness";
import { gameSetupReasons, isSetUp, pairedMemberIds, PICKEM_TYPE, type StoredMatchRow } from "@/lib/gameReadiness";
import { finishCapacityFor } from "@/lib/placeCapacity";
import { tripDisplayNames } from "@/server/lib/tripDisplayNames";

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
  /** The people in each game's FULLY PAIRED matches (a side is a user or a
   *  play group). Read only to count who is on no team; no id leaves the server. */
  pairedMembersByGame: Map<string, string[]>;
  /** Everyone playing in each game: its participants and the people in its
   *  paired matches. Read for the board's Needs attention card (who is
   *  playing on no team); ids never leave the server. */
  playerIdsByGame: Map<string, string[]>;
  /** Players with an account in each game: a teamless race's finishing places. */
  peopleCountByGame: Map<string, number>;
  /** Pick'em only: games on each slate. */
  slateCountByGame: Map<string, number>;
  /** Games that have begun producing results (`game_started`, migration 161). */
  startedByGame: Set<string>;
  /** The latest re-credit of each finished game (PR 8c): who, by their trip
   *  name, and when. Empty on the side board — a side game has no teams. */
  recreditByGame: Map<string, { byName: string; at: string }>;
  /**
   * The games that are THE VIEWER'S (PR 9d, ruling 5's "yours first"): ones
   * they are playing in, or running as a delegate. Computed here, on the
   * server, from rows the viewer's own session can read — and only the
   * boolean leaves (`boardRow`'s `yours`). Other players' ids are never
   * sent to the client to work it out (Zach, 9d). Empty with no viewer.
   */
  viewerGameIds: Set<string>;
}

type GameRow = Record<string, unknown> & { id: unknown; game_type_id: unknown; competition_format?: unknown };

/**
 * The four child reads a board row needs, for `games`. Every read succeeds or
 * throws (the `rowOrThrow` family, #1468): a failed read here would render a
 * configured game as New, or a live game as Ready, and the leaderboard's clinch
 * writers act on the same counts.
 *
 * `owner` is the noun's owner in the failure sentence — "board's" for the
 * leaderboard (whose sentences #1468's tests pin exactly) and "trip's" for the
 * side board.
 */
export async function readBoardInputs(
  supabase: SupabaseClient,
  games: GameRow[],
  owner: "board's" | "trip's",
  /** The trip whose names a re-credit note uses. Null skips the read (the side
   *  board: no competition, so nothing can have been re-credited). */
  recreditsTripId: string | null = null,
  /** Whose board this is — for `yours`. Null (a server-side caller with no
   *  viewer: the finish push, re-credit) marks nothing. */
  viewerId: string | null = null
): Promise<BoardInputs> {
  const gameIds = games.map((g) => g.id as string);
  // A game's bracket-ness is resolved the way `games.finish` resolves it, so the
  // entrant read (skipped entirely when there is no bracket) and the write path
  // cannot disagree about which games are brackets.
  const bracketGameIds = games
    .filter((g) => isBracketGame(g.game_type_id as string | null, (g.competition_format as string | null) ?? null))
    .map((g) => g.id as string);
  const pickemGameIds = games.filter((g) => g.game_type_id === PICKEM_TYPE).map((g) => g.id as string);

  const [matchRowsRes, participantRowsRes, startedRowsRes, entrantRowsRes, delegateRowsRes, slateRowsRes] = await Promise.all([
    gameIds.length
      ? supabase.from("game_matches").select("game_id, side_a, side_b").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; side_a: unknown; side_b: unknown }[], error: null }),
    gameIds.length
      // `user_id` is read for `viewerGameIds` and goes no further than this
      // function: no participant's id reaches the payload.
      ? supabase.from("game_participants").select("game_id, play_group_id, user_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; play_group_id: string | null; user_id: string }[], error: null }),
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
    // The games the viewer RUNS (a delegate), for `yours`. Their own rows only.
    viewerId && gameIds.length
      ? supabase.from("game_delegates").select("game_id").eq("user_id", viewerId).in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string }[], error: null }),
    // A pick'em's slate: an empty one is its setup reason (it cannot open picks).
    pickemGameIds.length
      ? supabase.from("pickem_slate_games").select("game_id").in("game_id", pickemGameIds)
      : Promise.resolve({ data: [] as { game_id: string }[], error: null }),
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
  const peopleCountByGame = new Map<string, number>();
  const participantsByGame = new Map<string, { user_id: string | null; play_group_id: string | null }[]>();
  const viewerGameIds = new Set<string>();
  for (const r of rowsOrThrow(participantRowsRes, `${owner} participants`) as { game_id: string; play_group_id: string | null; user_id: string }[]) {
    if (viewerId && r.user_id === viewerId) viewerGameIds.add(r.game_id);
    participantCountByGame.set(r.game_id, (participantCountByGame.get(r.game_id) ?? 0) + 1);
    if (r.user_id != null) peopleCountByGame.set(r.game_id, (peopleCountByGame.get(r.game_id) ?? 0) + 1);
    participantsByGame.set(r.game_id, [...(participantsByGame.get(r.game_id) ?? []), r]);
    if (r.play_group_id != null) {
      groupedParticipantCountByGame.set(r.game_id, (groupedParticipantCountByGame.get(r.game_id) ?? 0) + 1);
    }
  }
  // An unfilled slot is builder scaffolding, not a match: it never scores and
  // doesn't make the game Ready, so only BOTH-sides-paired rows count here.
  const matchCountByGame = new Map<string, number>();
  const totalMatchRowsByGame = new Map<string, number>();
  const matchRowsByGame = new Map<string, StoredMatchRow[]>();
  for (const r of rowsOrThrow(matchRowsRes, `${owner} matches`) as ({ game_id: string } & StoredMatchRow)[]) {
    totalMatchRowsByGame.set(r.game_id, (totalMatchRowsByGame.get(r.game_id) ?? 0) + 1);
    matchRowsByGame.set(r.game_id, [...(matchRowsByGame.get(r.game_id) ?? []), r]);
    if (!r.side_a?.id || !r.side_b?.id) continue;
    matchCountByGame.set(r.game_id, (matchCountByGame.get(r.game_id) ?? 0) + 1);
  }

  const pairedMembersByGame = new Map<string, string[]>();
  for (const [gid, rows] of matchRowsByGame) pairedMembersByGame.set(gid, pairedMemberIds(rows, participantsByGame.get(gid) ?? []));
  const slateCountByGame = new Map<string, number>();
  for (const r of rowsOrThrow(slateRowsRes, `${owner} slates`) as { game_id: string }[]) {
    slateCountByGame.set(r.game_id, (slateCountByGame.get(r.game_id) ?? 0) + 1);
  }

  const playerIdsByGame = new Map<string, string[]>();
  for (const g of games) {
    const gid = g.id as string;
    const ids = [
      ...(participantsByGame.get(gid) ?? []).map((p) => p.user_id).filter((id): id is string => !!id),
      ...(pairedMembersByGame.get(gid) ?? []),
    ];
    playerIdsByGame.set(gid, [...new Set(ids)]);
  }

  return {
    participantCountByGame,
    groupedParticipantCountByGame,
    matchCountByGame,
    totalMatchRowsByGame,
    entrantCountByGame,
    pairedMembersByGame,
    playerIdsByGame,
    peopleCountByGame,
    slateCountByGame,
    startedByGame,
    recreditByGame: await readRecredits(supabase, games, owner, recreditsTripId),
    viewerGameIds: (() => {
      for (const r of rowsOrThrow(delegateRowsRes, `${owner} delegations`) as { game_id: string }[]) viewerGameIds.add(r.game_id);
      return viewerGameIds;
    })(),
  };
}

/**
 * "Re-credited by Zach · Oct 4" (PR 8c). A re-credit changes standings after
 * the fact; a silent one breeds suspicion, so every member sees who moved a
 * finished game's credit and when. The before-and-after detail stays in
 * `game_recredits` for anyone investigating — the row says only who and when.
 *
 * Only FINISHED games can carry one, so only they are read. The name is the
 * one the crew knows the Owner by (`tripDisplayNames`), like every other
 * person named on the board.
 */
async function readRecredits(
  supabase: SupabaseClient,
  games: GameRow[],
  owner: "board's" | "trip's",
  tripId: string | null
): Promise<Map<string, { byName: string; at: string }>> {
  const out = new Map<string, { byName: string; at: string }>();
  const finished = games.filter((g) => g.status === "complete").map((g) => g.id as string);
  if (!tripId || finished.length === 0) return out;
  const rows = rowsOrThrow(
    await supabase
      .from("game_recredits")
      .select("game_id, recredited_by, recredited_at")
      .in("game_id", finished)
      .order("recredited_at", { ascending: false }),
    `${owner} re-credits`
  ) as { game_id: string; recredited_by: string | null; recredited_at: string }[];
  if (rows.length === 0) return out;
  const latest = new Map<string, { by: string | null; at: string }>();
  for (const r of rows) if (!latest.has(r.game_id)) latest.set(r.game_id, { by: r.recredited_by, at: r.recredited_at });
  const names = await tripDisplayNames(
    supabase,
    tripId,
    [...latest.values()].map((l) => l.by).filter((b): b is string => !!b)
  );
  for (const [gameId, l] of latest) {
    out.set(gameId, { byName: (l.by && names.get(l.by)) || "Someone", at: l.at });
  }
  return out;
}

/** The cup a board row's game belongs to, for its setup reasons: how many
 *  teams, and who is on one. Null on the side board (a side game has neither). */
export interface BoardCup {
  teamCount: number;
  teamedUserIds: ReadonlySet<string>;
}

/**
 * One game's board row. Pure: everything it needs is in `g`, `inputs`,
 * `pointsTotal` (the leaderboard's points-in-play; a side game has none) and
 * `cup`.
 */
export function boardRow(g: GameRow, inputs: BoardInputs, pointsTotal: number | null, cup: BoardCup | null = null) {
  const rawDist = g.points_distribution as PointsDistribution | null;
  const typeId = (g.game_type_id as string | null) ?? null;
  // POSITIVE, not non-null (#1029): every game is created with a 0 sentinel.
  const hasPoints = hasPositivePoints({ points_total: g.points_total, points_distribution: g.points_distribution });
  const gid = g.id as string;
  // What this game still needs (`gameSetupReasons`, the rule the settings pages
  // and the enable guard share). Codes and counts only: no id leaves here.
  const setupReasons = gameSetupReasons({
    gameTypeId: typeId,
    competitionFormat: (g.competition_format as string | null) ?? null,
    inCompetition: cup != null,
    cupHasTeams: (cup?.teamCount ?? 0) > 0,
    pointsTotal: (g.points_total as number | null) ?? null,
    pointsDistribution: rawDist,
    matchesTotal: inputs.totalMatchRowsByGame.get(gid) ?? 0,
    matchesPaired: inputs.matchCountByGame.get(gid) ?? 0,
    pairedPlayersOffTeam: cup ? (inputs.pairedMembersByGame.get(gid) ?? []).filter((id) => !cup.teamedUserIds.has(id)).length : 0,
    groupedPlayers: inputs.groupedParticipantCountByGame.get(gid) ?? 0,
    bracketEntrants: inputs.entrantCountByGame.get(gid) ?? 0,
    placeCapacity: finishCapacityFor({
      entrantCount: inputs.entrantCountByGame.get(gid) ?? 0,
      teamCount: cup?.teamCount ?? 0,
      peopleCount: inputs.peopleCountByGame.get(gid) ?? 0,
    }),
    slateGames: inputs.slateCountByGame.get(gid) ?? 0,
  });
  return {
    id: gid,
    name: (g.name as string | null) ?? "Game",
    distribution: isPlacement(rawDist) ? rawDist.values : null,
    status: g.status as string,
    gameTypeId: typeId,
    // A manual game's format (a bracket). Starting points read it: a suggestion
    // counts as added once a game of its format exists.
    competitionFormat: (g.competition_format as string | null) ?? null,
    // "ready to score" = points are configured (a distribution shape or an
    // owner-set total). Kept for the games-panel/test consumers.
    ready: hasPoints,
    // The §A readiness gate: is the format's REQUIRED roster assigned? Drives
    // the Setting-up↔Ready transition AND the `N PTS`/`—` outer column from ONE
    // signal so they can't disagree (course/handicaps never gate this).
    configured: isSetUp(setupReasons),
    // Why it is not ready yet, first thing to fix first (Needs attention). The
    // board's rows show these to the people who can fix them.
    setupReasons,
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
    // The viewer is playing in it or running it (PR 9d) — ONE boolean, nobody's id.
    yours: inputs.viewerGameIds.has(gid),
    // Re-opened for a score correction; only meaningful once `status` is
    // "complete". Not role-gated: members correct their own scores in it.
    correctionsOpen: g.corrections_open === true,
    // The latest re-credit (PR 8c) — who and when, for the finished row's note.
    // A different act from a correction above, and named apart from it.
    recredited: inputs.recreditByGame.get(gid) ?? null,
    // Points in play (§A5 outer column).
    pointsTotal,
    // The trip's ONE game order (PR 6b) — what lets the games page merge the
    // cup's games and side games into one sequence.
    displayOrder: (g.display_order as number | null) ?? null,
  };
}

export type BoardGameRow = ReturnType<typeof boardRow>;
