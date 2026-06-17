import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecided, matchState } from "@/lib/matchPlay";
import { effectiveStrokes } from "@/lib/handicap";
import { isPerMatch, type PerMatchDistribution } from "@/lib/pointsDistribution";

/**
 * DB-persist side of match-play results. Reads each `game_matches` row, gathers
 * both sides' gross `score_entries` + each side's `handicap_strokes`, builds the
 * decided sequence and runs the SHARED, frozen `matchState` (same rule the live
 * client strip uses — see `src/lib/matchPlay.ts`), then writes the match
 * `result`/`margin`/`status` and distills one `game_results` row per side.
 *
 * - Reads NET, never overwrites gross (`score_entries.value` stays raw — #16).
 * - Play-it-out holes never change a decided match (`matchState` is frozen).
 * - `competition_points_earned` stays null — points are a Slice D concern.
 * - Idempotent: a recompute updates the match rows in place and replaces the
 *   game's `game_results`.
 *
 * Stroke index: a game's own `scorecard_schema` snapshot (written when a course
 * is applied — Slice C) drives `buildDecided`. A no-course game has no snapshot,
 * so it falls through to `strokeHoles`'s sequential allocation — the documented
 * Slice B fallback, kept as the no-course path (NOT the template default, which
 * is only a display placeholder).
 */

interface SideRef {
  type: string;
  id: string;
}

export interface MatchOutcome {
  matchId: string;
  result: "a_win" | "b_win" | "halve" | null;
  margin: string | null;
  status: "pending" | "active" | "complete";
  thru: number;
}

interface GameResultRow {
  id: string;
  game_id: string;
  entity_id: string;
  entity_type: "user" | "play_group";
  raw_score: null;
  position: number;
  competition_points_earned: null;
}

export async function computeMatchPlayResults(
  supabase: SupabaseClient,
  gameId: string,
  opts?: { skipComplete?: boolean }
): Promise<MatchOutcome[]> {
  // Freeze boundary: incremental re-derives (setHandicap / assignPlayer) pass
  // skipComplete so a finished match's recorded result is never rewritten by a
  // late input edit. `finish` passes nothing → processes every match.
  const skipComplete = opts?.skipComplete ?? false;
  const { data: matches } = await supabase
    .from("game_matches")
    .select("id, side_a, side_b, status, result")
    .eq("game_id", gameId);

  // Stroke index: the game's course snapshot if one is applied, else undefined
  // → `buildDecided` uses the sequential fallback (the no-course path).
  const { strokeIndex, holeCount } = await loadStrokeIndex(supabase, gameId);

  // Side handicaps, keyed by SIDE id. A 1v1 side is a user (handicap on
  // game_participants); a 2v2 side is a pair = a play_group (handicap on
  // play_groups). Read both so one compute serves both formats — the id spaces
  // don't collide and a game only ever looks up its own side type's ids.
  const hcap = new Map<string, number>();
  const { data: parts } = await supabase
    .from("game_participants")
    .select("user_id, handicap_strokes")
    .eq("game_id", gameId);
  for (const p of parts ?? []) {
    hcap.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
  }
  const { data: pgroups } = await supabase
    .from("play_groups")
    .select("id, handicap_strokes")
    .eq("game_id", gameId);
  for (const pg of pgroups ?? []) {
    hcap.set(pg.id as string, effectiveStrokes(pg as { handicap_strokes: number | null }));
  }

  // Side gross, keyed by SIDE id → { unit_label → gross }. 1v1 records one entry
  // per user (participant_type='user'); 2v2 records one entry per side
  // (participant_type='play_group'). Read both and merge by id.
  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, unit_label, value")
    .eq("game_id", gameId)
    .in("participant_type", ["user", "play_group"]);
  // Nothing scored yet → nothing to derive. Skips the wasted recompute that the
  // setup-time setHandicap calls would otherwise trigger (no results to write).
  if ((entries ?? []).length === 0) return [];
  const gross = new Map<string, Record<string, number>>();
  for (const e of entries ?? []) {
    if (e.value == null) continue;
    const pid = e.participant_id as string;
    if (!gross.has(pid)) gross.set(pid, {});
    gross.get(pid)![e.unit_label as string] = e.value as number;
  }

  const outcomes: MatchOutcome[] = [];
  const resultRows: GameResultRow[] = [];
  const processedEntities: string[] = [];

  for (const m of matches ?? []) {
    if (skipComplete && m.status === "complete") continue; // frozen — leave as-is
    const a = m.side_a as SideRef | null;
    const b = m.side_b as SideRef | null;
    if (!a?.id || !b?.id) continue; // singles needs both sides set
    processedEntities.push(a.id, b.id);

    const decided = buildDecided(
      gross.get(a.id) ?? {},
      gross.get(b.id) ?? {},
      hcap.get(a.id) ?? 0,
      hcap.get(b.id) ?? 0,
      strokeIndex,
      holeCount
    );
    const st = matchState(decided);

    const result: MatchOutcome["result"] = st.over
      ? st.up === 0
        ? "halve"
        : st.leader === "A"
          ? "a_win"
          : "b_win"
      : null;
    const status: MatchOutcome["status"] = st.over
      ? "complete"
      : decided.length > 0
        ? "active"
        : "pending";
    const margin = st.over ? st.margin : null;

    await supabase.from("game_matches").update({ result, margin, status }).eq("id", m.id as string);
    outcomes.push({ matchId: m.id as string, result, margin, status, thru: st.thru });

    // One game_results row per side. position 1 leader / 2 trailing / both 1 on
    // square (ties share a position, like stroke play). raw_score null — match
    // play has no aggregate. Reflects current standing live and final on finish.
    const aTrailing = st.up > 0 && st.leader === "B";
    const bTrailing = st.up > 0 && st.leader === "A";
    // entity_type follows the side type: 'user' (1v1) or 'play_group' (2v2).
    resultRows.push(
      mkResult(gameId, a.id, aTrailing ? 2 : 1, a.type),
      mkResult(gameId, b.id, bTrailing ? 2 : 1, b.type)
    );
  }

  // Replace game_results for the processed sides only — when skipComplete, a
  // frozen match's rows are left intact; otherwise the whole game is rewritten.
  if (skipComplete) {
    if (processedEntities.length > 0) {
      await supabase.from("game_results").delete().eq("game_id", gameId).in("entity_id", processedEntities);
    }
  } else {
    await supabase.from("game_results").delete().eq("game_id", gameId);
  }
  if (resultRows.length > 0) {
    await supabase.from("game_results").insert(resultRows);
  }

  // Competition adapter: if this game is in a per_match competition, compute
  // per-team match totals and write entity_type='team' rows to game_results.
  // Runs AFTER user rows so the full picture is current before a leaderboard read.
  const { data: gameInfo } = await supabase
    .from("games")
    .select("competition_id, points_distribution")
    .eq("id", gameId)
    .maybeSingle();
  if (gameInfo?.competition_id && isPerMatch(gameInfo.points_distribution)) {
    await writeTeamMatchPoints(
      supabase,
      gameId,
      gameInfo.competition_id as string,
      (gameInfo.points_distribution as PerMatchDistribution).value,
      matches ?? [],
      outcomes
    );
  }

  return outcomes;
}

interface SchemaShape {
  units?: { count?: number; metadata?: { handicap_index?: number[] } };
}

/** The game's snapshot stroke index + hole count, if a course has been applied.
 *  No snapshot → undefined → caller uses the sequential fallback. */
async function loadStrokeIndex(
  supabase: SupabaseClient,
  gameId: string
): Promise<{ strokeIndex?: number[]; holeCount?: number }> {
  const { data: game } = await supabase
    .from("games")
    .select("scorecard_schema")
    .eq("id", gameId)
    .maybeSingle();
  const schema = game?.scorecard_schema as SchemaShape | null;
  return { strokeIndex: schema?.units?.metadata?.handicap_index, holeCount: schema?.units?.count };
}

function mkResult(
  gameId: string,
  entityId: string,
  position: number,
  sideType: string
): GameResultRow {
  return {
    id: crypto.randomUUID(),
    game_id: gameId,
    entity_id: entityId,
    // Normalize the side ref's type to the entity_type column's domain; a 1v1
    // side ('user') and a 2v2 side ('play_group') are the only cases.
    entity_type: sideType === "play_group" ? "play_group" : "user",
    raw_score: null,
    position,
    competition_points_earned: null,
  };
}

/** Aggregate decided match outcomes into per-team competition points and write
 *  them to game_results (entity_type='team', raw_score=accumulated points).
 *  Combines skipped-complete matches (from the initial query's result field)
 *  with freshly-computed outcomes so the team total is always complete. */
async function writeTeamMatchPoints(
  supabase: SupabaseClient,
  gameId: string,
  competitionId: string,
  perMatchValue: number,
  allMatches: { id: unknown; side_a: unknown; side_b: unknown; result: unknown }[],
  freshOutcomes: MatchOutcome[]
) {
  // Fresh outcomes override stale results for the matches we just processed.
  const resultByMatch = new Map<string, "a_win" | "b_win" | "halve" | null>();
  for (const m of allMatches) {
    resultByMatch.set(
      m.id as string,
      (m.result as "a_win" | "b_win" | "halve" | null) ?? null
    );
  }
  for (const o of freshOutcomes) {
    resultByMatch.set(o.matchId, o.result);
  }

  // user → team for this competition.
  const { data: assignments } = await supabase
    .from("team_assignments")
    .select("user_id, team_id")
    .eq("competition_id", competitionId);
  const userTeam = new Map<string, string>();
  for (const a of assignments ?? []) {
    userTeam.set(a.user_id as string, a.team_id as string);
  }

  // play_group → team (2v2): a side is a pair, so resolve its team via a member.
  // Both partners are on the same team in a two-team competition. Empty for 1v1.
  const { data: pgMembers } = await supabase
    .from("game_participants")
    .select("user_id, play_group_id")
    .eq("game_id", gameId);
  const pgTeam = new Map<string, string>();
  for (const gp of pgMembers ?? []) {
    const pg = gp.play_group_id as string | null;
    if (!pg || pgTeam.has(pg)) continue;
    const team = userTeam.get(gp.user_id as string);
    if (team) pgTeam.set(pg, team);
  }
  // A side resolves to its team via the user map (1v1) or the play_group map (2v2).
  const sideTeam = (s: SideRef): string | undefined =>
    s.type === "play_group" ? pgTeam.get(s.id) : userTeam.get(s.id);

  const teamPoints = new Map<string, number>();
  for (const m of allMatches) {
    const result = resultByMatch.get(m.id as string);
    if (!result) continue;
    const a = m.side_a as SideRef | null;
    const b = m.side_b as SideRef | null;
    if (!a?.id || !b?.id) continue;
    const aTeam = sideTeam(a);
    const bTeam = sideTeam(b);
    if (!aTeam || !bTeam) continue;

    if (result === "a_win") {
      teamPoints.set(aTeam, (teamPoints.get(aTeam) ?? 0) + perMatchValue);
    } else if (result === "b_win") {
      teamPoints.set(bTeam, (teamPoints.get(bTeam) ?? 0) + perMatchValue);
    } else {
      // halve — each side gets half
      teamPoints.set(aTeam, (teamPoints.get(aTeam) ?? 0) + perMatchValue / 2);
      teamPoints.set(bTeam, (teamPoints.get(bTeam) ?? 0) + perMatchValue / 2);
    }
  }

  // Replace all team rows for this game with fresh totals.
  await supabase
    .from("game_results")
    .delete()
    .eq("game_id", gameId)
    .eq("entity_type", "team");

  const rows = [...teamPoints.entries()].map(([teamId, pts]) => ({
    id: crypto.randomUUID(),
    game_id: gameId,
    entity_id: teamId,
    entity_type: "team" as const,
    raw_score: pts,
    position: null as number | null,
    competition_points_earned: null as null,
  }));
  if (rows.length > 0) {
    await supabase.from("game_results").insert(rows);
  }
}
