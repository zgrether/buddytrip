import type { SupabaseClient } from "@supabase/supabase-js";

export interface StrokeEntry {
  participant_id: string;
  value: number | null;
}

export interface StrokeStanding {
  entityId: string;
  rawScore: number;
  position: number;
}

/**
 * PURE stroke-play ranking (Slice A). Sums each participant's entered values
 * (gross — no handicap in A) and ranks ascending, low total wins. Ties share a
 * position, standard competition style (1, 2, 2, 4). Every passed participant
 * gets a row (rawScore 0 if they have no entries — Finish implies a complete
 * card, so that edge doesn't arise in normal play).
 *
 * This is the unit-tested core; `computeStrokePlayResults` is the thin DB wrapper.
 */
export function computeStrokePlayStandings(
  participantIds: string[],
  entries: StrokeEntry[]
): StrokeStanding[] {
  const totals = new Map<string, number>();
  for (const id of participantIds) totals.set(id, 0);
  for (const e of entries) {
    if (e.value == null) continue;
    totals.set(e.participant_id, (totals.get(e.participant_id) ?? 0) + e.value);
  }

  const rows = Array.from(totals, ([entityId, rawScore]) => ({ entityId, rawScore }));
  rows.sort((a, b) => a.rawScore - b.rawScore); // low wins
  return rows.map((r) => ({
    entityId: r.entityId,
    rawScore: r.rawScore,
    // ties share position; next position skips (standard competition ranking).
    position: 1 + rows.filter((o) => o.rawScore < r.rawScore).length,
  }));
}

/**
 * Read a game's participants + score entries, compute standings, and REPLACE
 * the game's `game_results` rows (entity_type 'user', competition_points_earned
 * null — standalone game). Idempotent: a recompute deletes prior rows first.
 * Called on Finish (Task 7).
 */
export async function computeStrokePlayResults(
  supabase: SupabaseClient,
  gameId: string
): Promise<StrokeStanding[]> {
  const { data: participants } = await supabase
    .from("game_participants")
    .select("user_id")
    .eq("game_id", gameId);
  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, value")
    .eq("game_id", gameId)
    .eq("participant_type", "user");

  const standings = computeStrokePlayStandings(
    (participants ?? []).map((p) => p.user_id as string),
    (entries ?? []) as StrokeEntry[]
  );

  await supabase.from("game_results").delete().eq("game_id", gameId);
  if (standings.length > 0) {
    await supabase.from("game_results").insert(
      standings.map((s) => ({
        id: crypto.randomUUID(),
        game_id: gameId,
        entity_id: s.entityId,
        entity_type: "user",
        raw_score: s.rawScore,
        position: s.position,
        competition_points_earned: null,
      }))
    );
  }
  return standings;
}
