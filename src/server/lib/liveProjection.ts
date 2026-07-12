import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecided, matchState } from "@/lib/matchPlay";
import { gloriousConfig } from "@/lib/gloriousHoles";
import type { ModifiersMap } from "@/lib/modifiers";
import { effectiveStrokes } from "@/lib/handicap";
import { rollupMatchPlay, type ProjMatch } from "@/lib/gameProjection";
import { playerStats, rackProjectedTeamPoints, type RackPlayer, type Team } from "@/lib/rackNStack";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import { MATCH_PLAY_TYPES, RACK_TYPE } from "@/server/lib/gameReadiness";

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
 * Only match singles/doubles + rack live games project; stroke has no on-page
 * rollup and non-golf never runs live (it posts straight to complete).
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
  /** per_match value from `points_distribution` — match play's pointsPerMatch.
   *  Unused by rack (which returns raw slot points to match its game page). */
  pointsPerMatch: number;
}

/** The per-game data the pure projection needs — built from the bulk reads by
 *  `computeLiveProjections`, or hand-constructed by a test. Keeps the projection
 *  math (side→team resolution, matchState→ProjMatch, computeRack) DB-free and
 *  unit-testable via `projectGame`. */
export interface GameProjectionData {
  schema: SchemaShape | null;
  modifiers: ModifiersMap | null;
  /** A2b: `point_value` is the per-match override (null → the even share). */
  matches: { side_a: SideRef | null; side_b: SideRef | null; point_value?: number | null }[];
  parts: { user_id: string; play_group_id: string | null; handicap_strokes: number | null }[];
  playGroups: { id: string; handicap_strokes: number | null }[];
  /** participant_id → { unit_label: gross }. */
  gross: Map<string, Record<string, number>>;
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
  const [gamesMetaRes, matchRowsRes, participantRowsRes, playGroupRowsRes, entryRowsRes, assignRes] =
    await Promise.all([
      supabase.from("games").select("id, scorecard_schema, modifiers").in("id", gameIds),
      supabase.from("game_matches").select("game_id, side_a, side_b, point_value").in("game_id", gameIds),
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

  const matchesByGame = new Map<string, { side_a: SideRef | null; side_b: SideRef | null; point_value: number | null }[]>();
  for (const m of matchRowsRes.data ?? []) {
    const arr = matchesByGame.get(m.game_id as string) ?? [];
    arr.push({
      side_a: (m.side_a as SideRef | null) ?? null,
      side_b: (m.side_b as SideRef | null) ?? null,
      point_value: (m.point_value as number | null) ?? null,
    });
    matchesByGame.set(m.game_id as string, arr);
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
  const { schema, matches, parts, playGroups, gross, userTeam } = data;
  const strokeIndex = schema?.units?.metadata?.handicap_index;
  const holeCount = schema?.units?.count;
  const glorious = gloriousConfig(g.gameTypeId, data.modifiers);

  // Side handicaps, keyed by SIDE id (1v1 side = a user; 2v2 side = a play_group).
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

  const projMatches: ProjMatch[] = [];
  for (const m of matches) {
    const a = m.side_a;
    const b = m.side_b;
    if (!a?.id || !b?.id) continue; // an unpaired slot isn't a match yet
    const decided = buildDecided(
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
  return rollupMatchPlay(projMatches, g.pointsPerMatch);
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
  // Rack's `per_match` = points PER SLOT; a legacy/placement rack has none → 1
  // (mirrors the decided path's `value = perMatch ? dist.value : 1`). × slots →
  // competition points, so the board rack pill reads in the same currency as a
  // match pill.
  const perSlotValue = g.pointsPerMatch || 1;
  const points = rackProjectedTeamPoints(players, coursePar, perSlotValue);
  return { [teamIds[0]]: points.A, [teamIds[1]]: points.B };
}
