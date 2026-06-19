import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeStrokePlayStandings,
  netStrokeEntries,
  type RawStrokeEntry,
  type StrokeStanding,
} from "@/lib/strokePlay";
import { strokeHoles } from "@/lib/matchPlay";
import { strokeIndexOf, unitsFromSchema } from "@/lib/strokePlayConfig";

/**
 * DB-persist side of stroke-play results (shape (b) — runs on Finish).
 *
 * Reads a game's participants + score entries, applies each player's handicap
 * as NET (a stroke comes off the holes `strokeHoles` allocates against the
 * game's course stroke index — the snapshot in `scorecard_schema`), computes
 * standings via the SHARED pure `computeStrokePlayStandings` (same rule the
 * live client strip uses — see `src/lib/strokePlay.ts`), and REPLACES the
 * game's `game_results` rows (entity_type 'user', competition_points_earned
 * null — standalone game). Idempotent: a recompute deletes prior rows first.
 *
 * Net is derived through the shared `netStrokeEntries` helper so the persisted
 * final and the live strip can't diverge. `score_entries.value` stays raw
 * gross; a handicap-less game nets to gross unchanged. The live strip does NOT
 * call this — it derives net client-side (shape (a)); only Finish persists here.
 */
export async function computeStrokePlayResults(
  supabase: SupabaseClient,
  gameId: string
): Promise<StrokeStanding[]> {
  const { data: participants } = await supabase
    .from("game_participants")
    .select("user_id, handicap_strokes")
    .eq("game_id", gameId);
  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, unit_label, value")
    .eq("game_id", gameId)
    .eq("participant_type", "user");
  const { data: game } = await supabase
    .from("games")
    .select("scorecard_schema")
    .eq("id", gameId)
    .single();

  // Hole-stroke index from the game's course snapshot (sequential fallback when
  // no course is applied). Each player's stroked holes drive the gross→net.
  const strokeIndex = strokeIndexOf(unitsFromSchema(game?.scorecard_schema));
  const strokedByPlayer: Record<string, Set<string>> = {};
  for (const p of participants ?? []) {
    strokedByPlayer[p.user_id as string] = new Set(
      [...strokeHoles((p.handicap_strokes as number) ?? 0, strokeIndex)].map(String)
    );
  }

  const standings = computeStrokePlayStandings(
    (participants ?? []).map((p) => p.user_id as string),
    netStrokeEntries((entries ?? []) as RawStrokeEntry[], strokedByPlayer)
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
