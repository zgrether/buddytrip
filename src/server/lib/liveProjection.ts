import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecided, buildDecidedFromOutcomes, matchState, type HoleOutcomeRow } from "@/lib/matchPlay";
import { gloriousConfig } from "@/lib/gloriousHoles";
import type { ModifiersMap } from "@/lib/modifiers";
import { effectiveStrokes } from "@/lib/handicap";
import { rollupMatchPlay, type ProjMatch, type CannotProjectReason } from "@/lib/gameProjection";
import { playerStats, rackProjectedTeamPoints, type RackPlayer, type Team } from "@/lib/rackNStack";
import { getGameTypeDefinition } from "@/lib/gameTypes";
import {
  liveMatchPointsPerMatch,
  liveRackPointsPerSlot,
  projectableMatchShare,
  payingSchedule,
  type PointsDistribution,
} from "@/lib/pointsDistribution";
import { MATCH_PLAY_TYPES, RACK_TYPE } from "@/server/lib/gameReadiness";
import { isMatchesGame, isPickemGame } from "@/lib/resultStrategy";
import { picksRevealed, type PickemClock } from "@/lib/pickemLifecycle";
import { pickemFinalize, pickemResolution } from "@/lib/pickemFinalize";
import { buildPickemFinalizeInput, type PickemFinalizeRows } from "@/server/lib/pickemResults";
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
 * Match singles/doubles, rack, non-golf **Matches** (`competition_format =
 * 'matches'`) and **pick'em** (3c) live games project. Stroke, scramble and
 * skins do NOT yet, and that is a decision rather than a gap: their arms would
 * land in points cups, which show no projection on any surface, so they move to
 * PR 9 with the points-race bars (#1120; #1416 must be settled first). Non-golf
 * placement and Simple win/tie post straight to complete with nothing to
 * preview in between.
 *
 * A format that projects can still be unable to, and says so: see
 * `ProjectionOutcome` and `CannotProjectReason`.
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
  /** The raw `games.points_distribution` — pick'em only, where a points cup
   *  pays by the schedule `effectiveDistribution` derives from it (3c). */
  pointsDistribution?: PointsDistribution | null;
}

/** A pick'em game's own rows, from the bulk reads (3c). */
export interface PickemProjectionData {
  clock: PickemClock;
  cfg: PickemFinalizeRows["cfg"];
  slate: PickemFinalizeRows["slate"];
  picks: PickemFinalizeRows["picks"];
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
  /** Pick'em only: its config, clock, slate and sheets. Absent = no
   *  `pickem_games` row, which is a game whose picks never opened. */
  pickem?: PickemProjectionData | null;
  /** The COMPETITION is a points cup (`scoring_model = 'points'`). Pick'em
   *  resolves by placement there and by head-to-head otherwise. */
  pointsMode?: boolean;
}

/** gameId → (teamId → projected points). Only games with a projection appear. */
export type LiveProjections = Record<string, Record<string, number>>;

/**
 * One game's projection, or the reason there isn't one (3c).
 *
 * `projectGame` returns `null` ONLY for a format with no live projection at
 * all. A format that projects but can't right now returns `cannot` with a
 * reason, and that is a different fact: "this game type doesn't preview" and
 * "this game would pay nothing" used to share one silent `null` (and, for
 * golf match play, a `0 | 0` that read as "nobody's up").
 */
export type ProjectionOutcome =
  | { kind: "projected"; byTeam: Record<string, number> }
  | { kind: "cannot"; reason: CannotProjectReason };

export interface LiveProjectionResult {
  projections: LiveProjections;
  /** gameId → why it can't project. Disjoint from `projections` by construction. */
  cannotProject: Record<string, CannotProjectReason>;
}

const projected = (byTeam: Record<string, number>): ProjectionOutcome => ({ kind: "projected", byTeam });
const cannot = (reason: CannotProjectReason): ProjectionOutcome => ({ kind: "cannot", reason });

/**
 * Is there nothing to pay — whatever happens in the game?
 *
 * Keyed on CONFIGURATION (the total, the legacy per-match value, any positive
 * override on a paired match), never on the computed share. The share also
 * depends on how many matches are paired, and a game with a total of 4 and no
 * pairings yet HAS points set; reporting it as `no_points` would name a cause
 * that isn't there.
 */
function noPointsToAward(
  pointsTotal: number | null,
  legacyValue: number | null | undefined,
  matches: { side_a: SideRef | null; side_b: SideRef | null; point_value?: number | null }[]
): boolean {
  const paysOverride = matches.some((m) => m.side_a?.id && m.side_b?.id && (m.point_value ?? 0) > 0);
  if (paysOverride) return false;
  // `liveMatchPointsPerMatch` reads the legacy value only when there is no
  // total; this mirrors that precedence rather than taking whichever is larger.
  const effective = pointsTotal != null ? pointsTotal : legacyValue ?? null;
  return effective == null || effective <= 0;
}

/** Dispatch one game to its format projection (pure — no DB). Exported for the
 *  unit test; `computeLiveProjections` calls it per game with data from the bulk
 *  reads. `null` = this FORMAT has no live projection (stroke, scramble, skins,
 *  non-golf placement); anything else says what it projects or why it can't. */
export function projectGame(input: LiveProjectionInput, data: GameProjectionData): ProjectionOutcome | null {
  const t = input.gameTypeId;
  if (isPickemGame(t, input.competitionFormat)) return projectPickem(input, data);
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
  games: LiveProjectionInput[],
  opts: { pointsMode?: boolean } = {}
): Promise<LiveProjectionResult> {
  const out: LiveProjections = {};
  const cannotProject: Record<string, CannotProjectReason> = {};
  if (games.length === 0) return { projections: out, cannotProject };
  const gameIds = games.map((g) => g.id);
  // Pick'em's own tables, read only when a pick'em game is live — the common
  // board has none and should not pay three empty queries for it.
  const pickemIds = games.filter((g) => isPickemGame(g.gameTypeId, g.competitionFormat)).map((g) => g.id);
  const none = Promise.resolve({ data: [] as Record<string, unknown>[] });
  const [pickemCfgRes, pickemSlateRes, pickemPicksRes] = await Promise.all(
    pickemIds.length === 0
      ? [none, none, none]
      : [
          supabase
            .from("pickem_games")
            .select("game_id, picks_opened_at, picks_deadline, picks_locked_at, roll_up, use_confidence")
            .in("game_id", pickemIds),
          supabase.from("pickem_slate_games").select("game_id, id, multiplier, result").in("game_id", pickemIds),
          // EVERY sheet the policy returns — the same shape `computePickemResults`
          // reads. Past reveal that is the field; before it, `projectPickem`
          // refuses before reading a row of it.
          supabase
            .from("pickem_picks")
            .select("game_id, user_id, slate_game_id, pick, confidence")
            .in("game_id", pickemIds),
        ]
  );
  const byGame = <T extends Record<string, unknown>>(rows: T[] | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) {
      const gid = r.game_id as string;
      (m.get(gid) ?? m.set(gid, []).get(gid)!).push(r);
    }
    return m;
  };
  const pickemCfgByGame = byGame(pickemCfgRes.data as Record<string, unknown>[] | null);
  const pickemSlateByGame = byGame(pickemSlateRes.data as Record<string, unknown>[] | null);
  const pickemPicksByGame = byGame(pickemPicksRes.data as Record<string, unknown>[] | null);
  const pickemDataFor = (gameId: string): PickemProjectionData | null => {
    const cfg = pickemCfgByGame.get(gameId)?.[0];
    if (!cfg) return null;
    return {
      clock: {
        picksOpenedAt: (cfg.picks_opened_at as string | null) ?? null,
        picksDeadline: (cfg.picks_deadline as string | null) ?? null,
        picksLockedAt: (cfg.picks_locked_at as string | null) ?? null,
      },
      cfg: { roll_up: cfg.roll_up, use_confidence: cfg.use_confidence },
      slate: (pickemSlateByGame.get(gameId) ?? []) as PickemProjectionData["slate"],
      picks: (pickemPicksByGame.get(gameId) ?? []) as PickemProjectionData["picks"],
    };
  };

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
      pickem: pickemIds.includes(g.id) ? pickemDataFor(g.id) : null,
      pointsMode: opts.pointsMode ?? false,
    });
    if (proj?.kind === "projected") out[g.id] = proj.byTeam;
    else if (proj?.kind === "cannot") cannotProject[g.id] = proj.reason;
  }
  return { projections: out, cannotProject };
}

/** Match singles/doubles → build each match's current standing (the same
 *  `buildDecided`→`matchState` the finish path runs), resolve each side to its
 *  team, and sum via the shared `rollupMatchPlay`. */
function projectMatch(g: LiveProjectionInput, data: GameProjectionData): ProjectionOutcome {
  const { schema, matches, parts, playGroups, gross, outcomes, userTeam } = data;
  // Golf match play's WRITER pays team rows only for a `per_match` game
  // (`matchPlay.ts`), so a game that isn't one awards nothing however it goes.
  // It used to project `0 | 0` here — the picture of "nobody's up", for a game
  // that could never pay anybody.
  if (!g.isPerMatch || noPointsToAward(g.pointsTotal, g.legacyValue, matches)) return cannot("no_points");
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
  // `isPerMatch` is already known true above.
  const pointsPerMatch = liveMatchPointsPerMatch(
    g.pointsTotal,
    matches.map((m) => ({ sideAId: m.side_a?.id ?? null, sideBId: m.side_b?.id ?? null, pointValue: m.point_value ?? null })),
    g.legacyValue
  );
  return projected(rollupMatchPlay(projMatches, pointsPerMatch));
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
function projectMatches(g: LiveProjectionInput, data: GameProjectionData): ProjectionOutcome {
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
  //
  // ── NOT gated on `isPerMatch` (#1381) ──────────────────────────────────────
  // A projection mirrors its WRITER, and this format's writer — `games.finish`'s
  // `matches` arm — pays from `points_total` whatever the distribution's shape.
  // Gating on `per_match` projected 0–0 for a game that would then pay real
  // points, and 0–0 reads as "not started", which is how BBMI 2026's Cornhole
  // inversion stayed invisible until finalize. Golf's `projectMatch` above keeps
  // its gate for the same reason in reverse: golf's writer (`matchPlay.ts`) only
  // writes team rows for a `per_match` game.
  //
  // "Cannot project" when there is nothing to pay: it must not render as a
  // projection of nothing. Keyed on configuration (`noPointsToAward`), which
  // also catches a total of 0 — `projectableMatchShare` alone returns a share
  // of 0 for that, and 0-0 is the picture of "nobody's won one yet".
  if (noPointsToAward(g.pointsTotal, g.legacyValue, matches)) return cannot("no_points");
  const pointsPerMatch = projectableMatchShare(
    g.pointsTotal,
    matches.map((m) => ({ sideAId: m.side_a?.id ?? null, sideBId: m.side_b?.id ?? null, pointValue: m.point_value ?? null })),
    g.legacyValue
  );
  if (pointsPerMatch == null) return cannot("no_points");

  return projected(tallyMatchAwards(matches, sideTeam, pointsPerMatch));
}

/**
 * Pick'em → what `games.finish` would pay if it ran NOW (3c, rulings 13 and 14).
 *
 * Not a re-derivation: the SAME `buildPickemFinalizeInput` finalize builds from,
 * into the SAME `pickemFinalize`. Unresolved contests are scored as void, which
 * is what finalize writes over them before it scores.
 *
 * ── GATED ON REVEAL, before anything is read out of the sheets ─────────────
 * The board is computed under the VIEWER's RLS (`competitions.leaderboard` →
 * `ctx.supabase`). Before reveal, `pickem_picks_select` returns a plain member
 * their OWN sheet only, and a captain the sheets they may proxy — so a
 * projection here would be wrong, and wrong differently per viewer; for a
 * captain it would also imply other people's unrevealed picks. Finalize refuses
 * the same state for its own reason (`computePickemResults`' gate), and this
 * mirrors its predicate rather than asking a second question.
 *
 * Not reachable through normal UI today: the results panel exists only once
 * picks are locked (`pickemSurface`), so a pick'em game is never "started"
 * before reveal. `set_pickem_result` has no reveal gate of its own, though, so
 * the direct-RPC path can reach it, and the leak would be real if it did.
 */
function projectPickem(g: LiveProjectionInput, data: GameProjectionData): ProjectionOutcome {
  const pk = data.pickem;
  if (!pk || !picksRevealed(pk.clock)) return cannot("picks_hidden");

  // The competition's teams, from the same roster map every arm uses. A team
  // with nobody on it is absent here and named 0 by the board's fill.
  const members = new Map<string, string[]>();
  for (const [userId, teamId] of data.userTeam) {
    (members.get(teamId) ?? members.set(teamId, []).get(teamId)!).push(userId);
  }
  const input = buildPickemFinalizeInput({
    game: { points_total: g.pointsTotal, points_distribution: g.pointsDistribution ?? null },
    cfg: pk.cfg,
    slate: pk.slate,
    picks: pk.picks,
    matches: data.matches.map((m) => ({ side_a: m.side_a, side_b: m.side_b, point_value: m.point_value ?? null })),
    competition: {
      pointsMode: data.pointsMode ?? false,
      teams: [...members.entries()].map(([id, memberIds]) => ({ id, memberIds })),
    },
  });

  // Nothing to award, asked per RESOLUTION because each pays from a different
  // place: a points cup from its schedule, team totals from the total alone
  // (overrides mean nothing there), individual matches from the total or a
  // paired override.
  const resolution = pickemResolution(input);
  const nothing =
    resolution === "placement"
      ? payingSchedule(input.distribution) == null
      : resolution === "simple"
        ? !((input.pointsTotal ?? 0) > 0)
        : noPointsToAward(input.pointsTotal, null, data.matches);
  if (nothing) return cannot("no_points");

  return projected(Object.fromEntries(pickemFinalize(input).awards));
}

/** Rack → the same read-model `computeRackNStackResults` builds, but in
 *  "projected" mode (pace-normalized net-to-par) and read-only. Returns raw slot
 *  points per team (matching `RackGameView`'s projection row — see file header). */
function projectRack(g: LiveProjectionInput, data: GameProjectionData): ProjectionOutcome {
  const { parts, gross, userTeam } = data;
  // Effective par/index: the game's course snapshot, else its format's default.
  let schema = data.schema;
  if (!schema?.units?.metadata?.par && g.gameTypeId) {
    schema = (getGameTypeDefinition(g.gameTypeId)?.scorecardSchema as SchemaShape | null) ?? null;
  }
  const par = schema?.units?.metadata?.par;
  const strokeIndex = schema?.units?.metadata?.handicap_index;
  if (!par || !strokeIndex) return cannot("no_course");
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
  if (teamIds.length < 2) return cannot("no_teams");
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
  return projected({ [teamIds[0]]: points.A, [teamIds[1]]: points.B });
}
