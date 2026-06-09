import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDecided, matchState } from "@/lib/matchPlay";

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
 * Stroke index: course metadata when a course is attached; the course is stubbed
 * in Slice B, so the sequential fallback in `buildDecided` is the normal path
 * until the Slice C course picker lands (replaces it with no change here).
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
  gameId: string
): Promise<MatchOutcome[]> {
  const { data: matches } = await supabase
    .from("game_matches")
    .select("id, side_a, side_b")
    .eq("game_id", gameId);

  // user_id → handicap strokes (null = 0).
  const { data: parts } = await supabase
    .from("game_participants")
    .select("user_id, handicap_strokes")
    .eq("game_id", gameId);
  const hcap = new Map<string, number>();
  for (const p of parts ?? []) {
    hcap.set(p.user_id as string, (p.handicap_strokes as number | null) ?? 0);
  }

  // user_id → { unit_label → gross }.
  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, unit_label, value")
    .eq("game_id", gameId)
    .eq("participant_type", "user");
  const gross = new Map<string, Record<string, number>>();
  for (const e of entries ?? []) {
    if (e.value == null) continue;
    const pid = e.participant_id as string;
    if (!gross.has(pid)) gross.set(pid, {});
    gross.get(pid)![e.unit_label as string] = e.value as number;
  }

  const outcomes: MatchOutcome[] = [];
  const resultRows: GameResultRow[] = [];

  for (const m of matches ?? []) {
    const a = m.side_a as SideRef | null;
    const b = m.side_b as SideRef | null;
    if (!a?.id || !b?.id) continue; // singles needs both sides set

    const decided = buildDecided(
      gross.get(a.id) ?? {},
      gross.get(b.id) ?? {},
      hcap.get(a.id) ?? 0,
      hcap.get(b.id) ?? 0
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

  await supabase.from("game_results").delete().eq("game_id", gameId);
  if (resultRows.length > 0) {
    await supabase.from("game_results").insert(resultRows);
  }

  return outcomes;
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
