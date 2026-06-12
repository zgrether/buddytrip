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
  units?: { labels?: string[]; metadata?: { par?: number[]; handicap_index?: number[] } };
}
export function unitsFromSchema(schema?: SchemaLike | null): ScoreUnit[] {
  const meta = schema?.units?.metadata;
  const labels = schema?.units?.labels;
  if (!labels?.length || !meta?.par || !meta?.handicap_index) return STROKE_PLAY_UNITS;
  return labels.map((label, i) => ({
    label,
    section: i < 9 ? "front" : "back",
    par: meta.par![i],
    strokeIndex: meta.handicap_index![i],
  }));
}

/** The stroke-index array (handicap index per hole) for `strokeHoles`/`buildDecided`. */
export function strokeIndexOf(units: ScoreUnit[]): number[] {
  return units.map((u) => u.strokeIndex ?? 0);
}

// Player identity palette (identity colors, not theme tokens — sanctioned like
// team colors per STYLE_GUIDE §7).
export const PLAYER_COLORS = ["#2dd4bf", "#60a5fa", "#f59e0b", "#a855f7"];

/** 1–2 char initials from a free-text name (falls back to "?"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
