import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeStrokePlayStandings,
  type StrokeEntry,
  type StrokeStanding,
} from "@/lib/strokePlay";

/**
 * DB-persist side of stroke-play results (shape (b) — runs on Finish).
 *
 * Reads a game's participants + score entries, computes standings via the
 * SHARED pure `computeStrokePlayStandings` (same rule the live client strip
 * uses — see `src/lib/strokePlay.ts`), and REPLACES the game's `game_results`
 * rows (entity_type 'user', competition_points_earned null — standalone game).
 * Idempotent: a recompute deletes prior rows first.
 *
 * The live strip does NOT call this — it sums the loaded entries client-side
 * (shape (a)); only Finish persists the final record here.
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
