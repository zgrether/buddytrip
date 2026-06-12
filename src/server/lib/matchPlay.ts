import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecided, matchState } from "@/lib/matchPlay";
import { effectiveStrokes } from "@/lib/handicap";

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
  entity_type: "user";
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
    .select("id, side_a, side_b, status")
    .eq("game_id", gameId);

  // Stroke index: the game's course snapshot if one is applied, else undefined
  // → `buildDecided` uses the sequential fallback (the no-course path).
  const { strokeIndex, holeCount } = await loadStrokeIndex(supabase, gameId);

  // user_id → handicap strokes (null = 0).
  const { data: parts } = await supabase
    .from("game_participants")
    .select("user_id, handicap_strokes")
    .eq("game_id", gameId);
  const hcap = new Map<string, number>();
  for (const p of parts ?? []) {
    hcap.set(p.user_id as string, effectiveStrokes(p as { handicap_strokes: number | null }));
  }

  // user_id → { unit_label → gross }.
  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, unit_label, value")
    .eq("game_id", gameId)
    .eq("participant_type", "user");
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
    resultRows.push(
      mkResult(gameId, a.id, aTrailing ? 2 : 1),
      mkResult(gameId, b.id, bTrailing ? 2 : 1)
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

function mkResult(gameId: string, entityId: string, position: number): GameResultRow {
  return {
    id: crypto.randomUUID(),
    game_id: gameId,
    entity_id: entityId,
    entity_type: "user",
    raw_score: null,
    position,
    competition_points_earned: null,
  };
}
