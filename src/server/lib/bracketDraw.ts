import type { SupabaseClient } from "@supabase/supabase-js";
import type { BracketSide } from "@/lib/bracket";

/**
 * Reading a bracket's stored draw — the DB half, shared by every server reader.
 *
 * MOVED here from `games.ts` when the finalize gained a bracket arm and became the
 * third caller (after `games.bracketDraw` and `games.pickWinner`). Nothing about
 * the read changed; it lives in `server/lib` now because the results derivation
 * beside it (`bracketResults.ts`) needs it too, and importing it back out of the
 * router would be a cycle.
 */

/** One `bracket_matches` row, as the draw read, the pick write and the finalize
 *  all need it. */
export interface BracketMatchRow {
  id: string;
  bracket: BracketSide;
  round: number;
  slot: number;
  entrant_a_id: string | null;
  entrant_b_id: string | null;
  winner_entrant_id: string | null;
}

export interface BracketDrawRead {
  matches: BracketMatchRow[];
  seedOf: (id: string | null) => number | null;
  idOfSeed: (seed: number) => string | null;
  error: string | null;
}

/**
 * The stored draw plus the seed↔entrant-id mapping, in one place.
 *
 * Two reads rather than three aliased PostgREST embeds of the same table.
 * `bracket_matches` has three FKs into `bracket_entrants` (A, B, winner), and a
 * mis-named embed is precisely the shape of #16's landmine — a relation that
 * didn't exist returned nothing and the error was swallowed for six weeks. Two
 * plain selects and a JS map cannot fail that way, and BOTH errors are checked:
 * an unread entrant list would silently turn every seed into null, which reads
 * as "the draw is empty" rather than as a failure.
 *
 * `idOfSeed` composes the deterministic id (`<game_id>:e<seed>`, migration 115)
 * only as a FALLBACK. The mapping from the entrants actually read is preferred,
 * so this keeps working if that id scheme is ever revised — the composed form is
 * a convenience, never the source of truth.
 */
export async function readBracketDraw(
  supabase: SupabaseClient,
  gameId: string
): Promise<BracketDrawRead> {
  const [matchRes, entrantRes] = await Promise.all([
    supabase
      .from("bracket_matches")
      .select("id, bracket, round, slot, entrant_a_id, entrant_b_id, winner_entrant_id")
      .eq("game_id", gameId)
      .order("bracket")
      .order("round")
      .order("slot"),
    supabase.from("bracket_entrants").select("id, seed").eq("game_id", gameId).order("seed"),
  ]);
  const empty = { matches: [] as BracketMatchRow[], seedOf: () => null, idOfSeed: () => null };
  if (matchRes.error) return { ...empty, error: matchRes.error.message };
  if (entrantRes.error) return { ...empty, error: entrantRes.error.message };

  const seedById = new Map<string, number>();
  const idBySeed = new Map<number, string>();
  for (const e of (entrantRes.data ?? []) as { id: string; seed: number }[]) {
    seedById.set(e.id, e.seed);
    idBySeed.set(e.seed, e.id);
  }
  return {
    matches: (matchRes.data ?? []) as BracketMatchRow[],
    seedOf: (id) => (id === null ? null : seedById.get(id) ?? null),
    idOfSeed: (seed) => idBySeed.get(seed) ?? `${gameId}:e${seed}`,
    error: null,
  };
}
