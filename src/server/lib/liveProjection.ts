import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecided, buildDecidedFromOutcomes, matchState, type HoleOutcomeRow } from "@/lib/matchPlay";
import { gloriousConfig } from "@/lib/gloriousHoles";
import type { ModifiersMap } from "@/lib/modifiers";
import { effectiveStrokes } from "@/lib/handicap";
import { rollupMatchPlay, type ProjMatch } from "@/lib/gameProjection";
import { playerStats, rackProjectedTeamPoints, type RackPlayer, type Team } from "@/lib/rackNStack";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { liveMatchPointsPerMatch, liveRackPointsPerSlot } from "@/lib/pointsDistribution";
import { MATCH_PLAY_TYPES, RACK_TYPE } from "@/server/lib/gameReadiness";
import { isMatchesGame } from "@/lib/resultStrategy";
import { tallyMatchAwards } from "@/lib/matchAwards";

/**
 * Live-game projected-points, server-side (leaderboard grid Phase 2, Path A).
 *
 * The competition board needs a per-team "if today holds" projection for each
 * in-progress game, but its main compute (`competitionLeaderboard.ts`) reads only
 * REALIZED `game_results`. This helper fills that gap by running the SAME pure
 * projection functions the game pages use — `rollupMatchPlay` (match) and
 * `computeRack("projected")` (rack) — server-side, so the board pill and the
 * game-page projection row can't diverge (CLAUDE.md #8, same principle that lets
 * `computeMatchPlayResults` reuse `matchState`). READ-ONLY: no writes, no result
 * rows — it mirrors the finish path's reads but stops at the pure rollup.
 *
 * Rides the board's existing 30s poll (it's extra fields on the same payload), so
 * projections converge across devices with zero new polling.
 *
 * Values match each format's game page verbatim, both in COMPETITION points:
 *  - match → pointsPerMatch per won match (`rollupMatchPlay`);
 *  - rack  → projected slots × per-slot value (`rackProjectedTeamPoints`, which
 *    mirrors the decided path's `teamPoints × value`). Both the board and the rack
 *    game page call that shared helper, so they can't diverge.
 *
 * Match singles/doubles, rack, and non-golf **Matches** (`competition_format =
 * 'matches'`) live games project; stroke has no on-page rollup and every other
 * non-golf shape (placement, Simple win/tie) posts straight to complete with
 * nothing to preview in between.
 *
 * Matches' projection is simpler than golf's: there is no partial "leading"
 * state to credit (a match is declared or it isn't — see `matchAwards.ts`'s
 * header for why it skips the whole hole-sequence half of match play), so it
 * sums only DECIDED matches via the exact same `tallyMatchAwards` the eventual
 * `games.finish` write calls (CLAUDE.md #8's split, one level down from a whole
 * game). READ-ONLY here too: entering a result never touches `game_results` or
 * the leaderboard's persisted state — only `games.finish` does that, same as
 * every other format this file projects.
 */

interface SideRef {
  type: string;
  id: string;
}
interface SchemaShape {
  units?: { count?: number; metadata?: { par?: number[]; handicap_index?: number[] } };
}

export interface LiveProjectionInput {
  id: string;
  gameTypeId: string | null;
  /** `games.competition_format` — the ONLY way to tell a Matches game apart
   *  from every other non-golf shape; `gameTypeId` alone can't (Phase 0 §1,
   *  same reason `resolveResultStrategy` reads it too). Null for golf/rack. */
  competitionFormat?: string | null;
  /** The owner-set total this game is worth. #1031: the per-match/per-slot
   *  value is derived from this LIVE (from the current assigned matches / grouped
   *  roster in `GameProjectionData`), never read from a persisted
   *  `points_distribution.value` snapshot — see `liveMatchPointsPerMatch` /
   *  `liveRackPointsPerSlot`. */
  pointsTotal: number | null;
  /** Is this game's `points_distribution` shaped `per_match`? Gates the derive
   *  above (a placement/null distribution awards nothing per match/slot here). */
  isPerMatch: boolean;
  /** The persisted `points_distribution.value` — consulted ONLY as the legacy
   *  fallback when `pointsTotal` is null (a pre-A2b game with no owner-set
   *  total has no total to derive an even share from). Ignored whenever
   *  `pointsTotal` is set. */
  legacyValue?: number | null;
  /** Refactor B3: an outcome-mode match projects from recorded hole outcomes,
   *  not gross scores (it has none). Unused by rack. */
  outcomeMode?: boolean;
}

/** The per-game data the pure projection needs — built from the bulk reads by
 *  `computeLiveProjections`, or hand-constructed by a test. Keeps the projection
 *  math (side→team resolution, matchState→ProjMatch, computeRack) DB-free and
 *  unit-testable via `projectGame`. */
export interface GameProjectionData {
  schema: SchemaShape | null;
  modifiers: ModifiersMap | null;
  /** A2b: `point_value` is the per-match override (null → the even share).
   *  `result` is Matches-only (undefined for golf, which derives its own
   *  standing from holes/outcomes below rather than a stored result). */
  matches: { id: string; side_a: SideRef | null; side_b: SideRef | null; point_value?: number | null; result?: "a_win" | "b_win" | "halve" | null }[];
  parts: { user_id: string; play_group_id: string | null; handicap_strokes: number | null }[];
  playGroups: { id: string; handicap_strokes: number | null }[];
  /** participant_id → { unit_label: gross }. Score-mode only. */
  gross: Map<string, Record<string, number>>;
  /** Refactor B3: recorded hole outcomes for this game's matches, outcome-mode
   *  only — empty for a score-mode game. */
  outcomes: { match_id: string; hole_number: number; result: HoleOutcomeRow["result"] }[];
  /** user_id → team_id (competition-level). */
  userTeam: Map<string, string>;
}

/** gameId → (teamId → projected points). Only games with a projection appear. */
export type LiveProjections = Record<string, Record<string, number>>;

/** Dispatch one game to its format projection (pure — no DB). Exported for the
 *  unit test; `computeLiveProjections` calls it per game with data from the bulk
 *  reads. Unknown/stroke/non-golf types return null (no live projection). */
export function projectGame(input: LiveProjectionInput, data: GameProjectionData): Record<string, number> | null {
  const t = input.gameTypeId;
  // Matches decides FIRST — same reason `NonGolfScoreboard` checks it before
  // `winLoseTie`: `gameTypeId` alone (a generic non-golf card type) says
  // nothing about how this game resolves, only `competition_format` does.
  if (isMatchesGame(t, input.competitionFormat)) return projectMatches(input, data);
  if (t && MATCH_PLAY_TYPES.has(t)) return projectMatch(input, data);
  if (t === RACK_TYPE) return projectRack(input, data);
  return null;
}

export async function computeLiveProjections(
  supabase: SupabaseClient,
  competitionId: string,
  games: LiveProjectionInput[]
): Promise<LiveProjections> {
  const out: LiveProjections = {};
  if (games.length === 0) return out;
  const gameIds = games.map((g) => g.id);

  // Bulk reads, scoped to the live game ids only (a completed game's per-hole
  // scores never load). One wave, parallel — the board compute's cost stays a
  // fixed handful of extra queries regardless of live-game count.
  const [gamesMetaRes, matchRowsRes, participantRowsRes, playGroupRowsRes, entryRowsRes, outcomeRowsRes, assignRes] =
    await Promise.all([
      supabase.from("games").select("id, scorecard_schema, modifiers").in("id", gameIds),
      supabase.from("game_matches").select("id, game_id, side_a, side_b, point_value, result").in("game_id", gameIds),
      supabase
        .from("game_participants")
        .select("game_id, user_id, play_group_id, handicap_strokes")
        .in("game_id", gameIds),
      supabase.from("play_groups").select("game_id, id, handicap_strokes").in("game_id", gameIds),
      supabase
        .from("score_entries")
        .select("game_id, participant_id, unit_label, value")
        .in("game_id", gameIds)
        .in("participant_type", ["user", "play_group"]),
      // Refactor B3: the outcome-mode counterpart to entryRowsRes — empty for a
      // score-mode game (harmless to fetch unconditionally, same pattern as
      // startedByGame's merge in competitionLeaderboard.ts).
      supabase.from("match_hole_outcomes").select("game_id, match_id, hole_number, result").in("game_id", gameIds),
      supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
    ]);

  const userTeam = new Map<string, string>();
  for (const a of assignRes.data ?? []) userTeam.set(a.user_id as string, a.team_id as string);

  const metaByGame = new Map<string, { schema: SchemaShape | null; modifiers: ModifiersMap | null }>();
  for (const g of gamesMetaRes.data ?? []) {
    metaByGame.set(g.id as string, {
      schema: (g.scorecard_schema as SchemaShape | null) ?? null,
      modifiers: (g.modifiers as ModifiersMap | null) ?? null,
    });
  }

  const matchesByGame = new Map<
    string,
    { id: string; side_a: SideRef | null; side_b: SideRef | null; point_value: number | null; result: "a_win" | "b_win" | "halve" | null }[]
  >();
  for (const m of matchRowsRes.data ?? []) {
    const arr = matchesByGame.get(m.game_id as string) ?? [];
    arr.push({
      id: m.id as string,
      side_a: (m.side_a as SideRef | null) ?? null,
      side_b: (m.side_b as SideRef | null) ?? null,
      point_value: (m.point_value as number | null) ?? null,
      result: (m.result as "a_win" | "b_win" | "halve" | null) ?? null,
    });
    matchesByGame.set(m.game_id as string, arr);
  }

  // Refactor B3: game → this game's recorded hole outcomes (outcome-mode only —
  // empty array for a score-mode game).
  const outcomesByGame = new Map<string, { match_id: string; hole_number: number; result: HoleOutcomeRow["result"] }[]>();
  for (const o of outcomeRowsRes.data ?? []) {
    const gid = o.game_id as string;
    const arr = outcomesByGame.get(gid) ?? [];
    arr.push({ match_id: o.match_id as string, hole_number: o.hole_number as number, result: o.result as HoleOutcomeRow["result"] });
    outcomesByGame.set(gid, arr);
  }

  const partsByGame = new Map<
    string,
    { user_id: string; play_group_id: string | null; handicap_strokes: number | null }[]
  >();
  for (const p of participantRowsRes.data ?? []) {
    const arr = partsByGame.get(p.game_id as string) ?? [];
    arr.push({
      user_id: p.user_id as string,
      play_group_id: (p.play_group_id as string | null) ?? null,
      handicap_strokes: (p.handicap_strokes as number | null) ?? null,
    });
    partsByGame.set(p.game_id as string, arr);
  }

  const pgByGame = new Map<string, { id: string; handicap_strokes: number | null }[]>();
  for (const pg of playGroupRowsRes.data ?? []) {
    const arr = pgByGame.get(pg.game_id as string) ?? [];
    arr.push({ id: pg.id as string, handicap_strokes: (pg.handicap_strokes as number | null) ?? null });
    pgByGame.set(pg.game_id as string, arr);
  }

  // game → participant_id → { unit_label: gross }.
  const grossByGame = new Map<string, Map<string, Record<string, number>>>();
  for (const e of entryRowsRes.data ?? []) {
    if (e.value == null) continue;
    const gid = e.game_id as string;
    const gm = grossByGame.get(gid) ?? new Map<string, Record<string, number>>();
    const pid = e.participant_id as string;
    const rec = gm.get(pid) ?? {};
    rec[e.unit_label as string] = e.value as number;
    gm.set(pid, rec);
    grossByGame.set(gid, gm);
  }

  for (const g of games) {
    const meta = metaByGame.get(g.id);
    const proj = projectGame(g, {
      schema: meta?.schema ?? null,
      modifiers: meta?.modifiers ?? null,
      matches: matchesByGame.get(g.id) ?? [],
      parts: partsByGame.get(g.id) ?? [],
      playGroups: pgByGame.get(g.id) ?? [],
      gross: grossByGame.get(g.id) ?? new Map(),
      outcomes: outcomesByGame.get(g.id) ?? [],
      userTeam,
    });
    if (proj) out[g.id] = proj;
  }
  return out;
}

/** Match singles/doubles → build each match's current standing (the same
 *  `buildDecided`→`matchState` the finish path runs), resolve each side to its
 *  team, and sum via the shared `rollupMatchPlay`. */
function projectMatch(g: LiveProjectionInput, data: GameProjectionData): Record<string, number> | null {
  const { schema, matches, parts, playGroups, gross, outcomes, userTeam } = data;
  const strokeIndex = schema?.units?.metadata?.handicap_index;
  const holeCount = schema?.units?.count;
  // Entry mode gates glorious (outcome entry only) — `outcomeMode` is already on
  // the input, derived from `games.entry_mode` by the leaderboard's bulk read.
  const glorious = gloriousConfig(g.gameTypeId, data.modifiers, g.outcomeMode ? "outcome" : "score");

  // Side handicaps, keyed by SIDE id (1v1 side = a user; 2v2 side = a play_group).
  // Score-mode only — an outcome-mode match has no handicap application (the
  // recorded outcome IS the decision).
  const hcap = new Map<string, number>();
  for (const p of parts) hcap.set(p.user_id, effectiveStrokes(p));
  for (const pg of playGroups) hcap.set(pg.id, effectiveStrokes(pg));

  // play_group → team (2v2): resolve a pair's team via any member (both partners
  // share a team in a two-team competition).
  const pgTeam = new Map<string, string>();
  for (const p of parts) {
    if (!p.play_group_id || pgTeam.has(p.play_group_id)) continue;
    const t = userTeam.get(p.user_id);
    if (t) pgTeam.set(p.play_group_id, t);
  }
  const sideTeam = (s: SideRef | null): string | null => {
    if (!s?.id) return null;
    return (s.type === "play_group" ? pgTeam.get(s.id) : userTeam.get(s.id)) ?? null;
  };

  // Refactor B3: outcome-mode matches source decided holes from recorded
  // outcomes, grouped by match id — mirrors MatchGameView's decidedFor branch.
  const outcomesByMatch = new Map<string, HoleOutcomeRow[]>();
  for (const o of outcomes) {
    const arr = outcomesByMatch.get(o.match_id) ?? [];
    arr.push({ hole: o.hole_number, result: o.result });
    outcomesByMatch.set(o.match_id, arr);
  }

  const projMatches: ProjMatch[] = [];
  for (const m of matches) {
    const a = m.side_a;
    const b = m.side_b;
    if (!a?.id || !b?.id) continue; // an unpaired slot isn't a match yet
    const decided = g.outcomeMode
      ? buildDecidedFromOutcomes(outcomesByMatch.get(m.id) ?? [])
      : buildDecided(
          gross.get(a.id) ?? {},
          gross.get(b.id) ?? {},
          hcap.get(a.id) ?? 0,
          hcap.get(b.id) ?? 0,
          strokeIndex,
          holeCount
        );
    const st = matchState(decided, holeCount, glorious);
    projMatches.push({
      aTeamId: sideTeam(a),
      bTeamId: sideTeam(b),
      leader: st.leader,
      started: st.thru > 0,
      // A2b: carry this match's override so rollupMatchPlay awards it over the even share.
      points: m.point_value ?? null,
    });
  }
  // #1031: the even-share fallback is derived LIVE from `matches` (the CURRENT
  // assigned matches this bulk read just fetched) — never from a persisted
  // `points_distribution.value` snapshot, so the board's "if today holds" pill
  // can't lag a match invalidated outside a settings Save (a seat vacate).
  const pointsPerMatch = g.isPerMatch
    ? liveMatchPointsPerMatch(
        g.pointsTotal,
        matches.map((m) => ({ sideAId: m.side_a?.id ?? null, sideBId: m.side_b?.id ?? null, pointValue: m.point_value ?? null })),
        g.legacyValue
      )
    : 0;
  return rollupMatchPlay(projMatches, pointsPerMatch);
}

/** Non-golf Matches → sum only the DECIDED matches' awards via the exact same
 *  `tallyMatchAwards` `writeTeamMatchPoints` will eventually call — an
 *  undecided match contributes nothing (there is no partial "leading" state
 *  for a declared-outright result to be partway toward), unlike golf's
 *  in-progress matches above, which credit a live leader. Side→team
 *  resolution mirrors `projectMatch`'s (2v2 resolves via a play_group's
 *  member), duplicated rather than shared because the two run over
 *  differently-shaped match rows (this one carries `result`, golf's carries
 *  hole data) and a shared helper would need to abstract over both for no
 *  reader's benefit. */
function projectMatches(g: LiveProjectionInput, data: GameProjectionData): Record<string, number> | null {
  const { matches, parts, userTeam } = data;

  const pgTeam = new Map<string, string>();
  for (const p of parts) {
    if (!p.play_group_id || pgTeam.has(p.play_group_id)) continue;
    const t = userTeam.get(p.user_id);
    if (t) pgTeam.set(p.play_group_id, t);
  }
  const sideTeam = (s: SideRef): string | undefined =>
    (s.type === "play_group" ? pgTeam.get(s.id) : userTeam.get(s.id)) ?? undefined;

  // #1031's rule, same as golf's projectMatch: the even share is derived LIVE
  // from the CURRENT assigned matches, never a persisted snapshot.
  const pointsPerMatch = g.isPerMatch
    ? liveMatchPointsPerMatch(
        g.pointsTotal,
        matches.map((m) => ({ sideAId: m.side_a?.id ?? null, sideBId: m.side_b?.id ?? null, pointValue: m.point_value ?? null })),
        g.legacyValue
      )
    : 0;

  return tallyMatchAwards(matches, sideTeam, pointsPerMatch);
}

/** Rack → the same read-model `computeRackNStackResults` builds, but in
 *  "projected" mode (pace-normalized net-to-par) and read-only. Returns raw slot
 *  points per team (matching `RackGameView`'s projection row — see file header). */
function projectRack(g: LiveProjectionInput, data: GameProjectionData): Record<string, number> | null {
  const { parts, gross, userTeam } = data;
  // Effective par/index: the game's course snapshot, else its format's default.
  let schema = data.schema;
  if (!schema?.units?.metadata?.par && g.gameTypeId) {
    schema = (getGameTypeDefinition(g.gameTypeId)?.scorecardSchema as SchemaShape | null) ?? null;
  }
  const par = schema?.units?.metadata?.par;
  const strokeIndex = schema?.units?.metadata?.handicap_index;
  if (!par || !strokeIndex) return null;
  const coursePar = par.reduce((a, p) => a + p, 0);

  // The two competing teams, sorted deterministically for a stable A/B (the same
  // convention `computeRackNStackResults` uses). computeRack is symmetric, so the
  // A/B choice can't change a team's points — we map slot back to team id below.
  const teamOf = new Map<string, string>();
  for (const p of parts) {
    const t = userTeam.get(p.user_id);
    if (t) teamOf.set(p.user_id, t);
  }
  const teamIds = [...new Set([...teamOf.values()])].sort();
  if (teamIds.length < 2) return null;
  const slot: Record<string, Team> = { [teamIds[0]]: "A", [teamIds[1]]: "B" };

  const players: RackPlayer[] = [];
  for (const p of parts) {
    const tid = teamOf.get(p.user_id);
    if (!tid || !(tid in slot)) continue;
    players.push({
      id: p.user_id,
      team: slot[tid],
      stats: playerStats(gross.get(p.user_id) ?? {}, effectiveStrokes(p), par, strokeIndex),
    });
  }
  // #1031: the live SLOT count — rank-paired 1v1s = min(team-A roster, team-B
  // roster) — SAME predicate the `players` loop above uses to decide who
  // actually scores, recomputed from `parts` (this bulk read's CURRENT roster),
  // never from a persisted `points_distribution.value` snapshot.
  let teamACount = 0;
  let teamBCount = 0;
  for (const p of parts) {
    const tid = teamOf.get(p.user_id);
    if (tid === teamIds[0]) teamACount += 1;
    else if (tid === teamIds[1]) teamBCount += 1;
  }
  // Rack's `per_match` = points PER SLOT; a legacy/placement rack has none → 1
  // (mirrors the decided path's `value = perMatch ? liveRackPointsPerSlot(...) : 1`).
  // × slots → competition points, so the board rack pill reads in the same
  // currency as a match pill.
  const perSlotValue =
    (g.isPerMatch ? liveRackPointsPerSlot(g.pointsTotal, Math.min(teamACount, teamBCount), g.legacyValue) : 0) || 1;
  const points = rackProjectedTeamPoints(players, coursePar, perSlotValue);
  return { [teamIds[0]]: points.A, [teamIds[1]]: points.B };
}
