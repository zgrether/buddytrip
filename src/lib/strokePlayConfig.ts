import type { ScoreUnit } from "@/components/games/types";

/**
 * Client-side stroke-play scorecard config, shared by the DB-backed trip game
 * and the local-storage Quick Game.
 *
 * Temporary: the DB game's real units come from the template's
 * `scorecard_schema` once the Games tab (Slice E) wires it; Quick Game has no
 * template, so it uses this known stroke-play shape. The scorecard components
 * stay schema-driven (they take `units` as a prop) — this is just the data.
 */
// Default par-72 layout. No-course games have no real stroke index, so the
// default index is SEQUENTIAL (1..18) — the honest "strokes go in hole order"
// fallback that `strokeHoles` allocates on (and that the Slice B match tests
// assert). A real, non-sequential index arrives only when a course is applied
// (Slice C), at which point the game's snapshot drives par + index everywhere.
const DEFAULT_PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const DEFAULT_INDEX = Array.from({ length: 18 }, (_, i) => i + 1);

export const STROKE_PLAY_UNITS: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: DEFAULT_PAR[i],
  strokeIndex: DEFAULT_INDEX[i],
}));

/**
 * Derive scorecard units from a game's effective `scorecard_schema` (its course
 * snapshot when applied — Slice C — else the game-type template's default).
 * Falls back to STROKE_PLAY_UNITS when a schema is absent or malformed, so the
 * grid/entry/pips read the SAME par + index the server scores on.
 */
interface SchemaLike {
  units?: {
    labels?: string[];
    metadata?: {
      par?: number[];
      handicap_index?: number[];
      tee?: { name: string; yards?: (number | null)[] };
    };
  };
}
export function unitsFromSchema(schema?: SchemaLike | null): ScoreUnit[] {
  const meta = schema?.units?.metadata;
  const labels = schema?.units?.labels;
  if (!labels?.length || !meta?.par) return STROKE_PLAY_UNITS;
  // The stroke index is OPTIONAL: an index-less course snapshots par with no
  // handicap_index, so strokeIndex stays undefined here → the GolfCard INDEX row
  // omits itself and strokeHoles falls back to sequential.
  const hasIndex = meta.handicap_index?.length === labels.length;
  // Configured tee yardage (informational) — present only when a course/tee is
  // applied; per-hole, may be null on a hole the tee never had a yardage for.
  const teeYards = meta.tee?.yards;
  return labels.map((label, i) => ({
    label,
    section: i < 9 ? "front" : "back",
    par: meta.par![i],
    strokeIndex: hasIndex ? meta.handicap_index![i] : undefined,
    yardage: teeYards?.[i] ?? undefined,
  }));
}

/** The configured tee's display meta (name + ratings) from a schema snapshot,
 *  for the scorecard header. Null when no course/tee is applied. */
export function teeFromSchema(schema?: {
  units?: { metadata?: { tee?: { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } } };
} | null): { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } | null {
  return schema?.units?.metadata?.tee ?? null;
}

/**
 * The per-hole stroke-index array for `strokeHoles` / `buildDecided` / `strokeHint`.
 *
 * A course's index is all-or-nothing (the picker blocks partial saves), so units
 * are either ALL ranked or ALL unranked. When complete we return the real index;
 * when ABSENT we return the SEQUENTIAL identity `[1..N]` — **never a zero-fill**.
 * A `[0,0,…]` array is the trap: `strokeHoles` treats any length-N array as a real
 * index and `(0-1) % N = -1 < n` strikes EVERY hole, which both mis-allocates and
 * diverges from the server (it scores the index-less snapshot via `strokeHoles`'
 * `undefined` → sequential fallback). Identity `[1..N]` reproduces that exact
 * sequential allocation and makes the handicap hint read "first N holes".
 */
export function strokeIndexOf(units: ScoreUnit[]): number[] {
  if (units.every((u) => u.strokeIndex != null)) return units.map((u) => u.strokeIndex as number);
  return units.map((_, i) => i + 1); // sequential identity — no real index present
}

// Player identity palette (identity colors, not theme tokens — sanctioned like
// team colors per STYLE_GUIDE §7).
export const PLAYER_COLORS = ["#2dd4bf", "#60a5fa", "#f59e0b", "#a855f7"];
