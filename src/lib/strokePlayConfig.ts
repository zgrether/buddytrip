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
// Default par-72 layout + handicap index (matches the template
// `scorecard_schema.metadata.{par,handicap_index}`). Real per-hole values replace
// these once a course is attached (Slice C picker). The index follows the common
// odd-front / even-back convention (1 = hardest).
const DEFAULT_PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const DEFAULT_INDEX = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];

export const STROKE_PLAY_UNITS: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: DEFAULT_PAR[i],
  strokeIndex: DEFAULT_INDEX[i],
}));

// Player identity palette (identity colors, not theme tokens — sanctioned like
// team colors per STYLE_GUIDE §7).
export const PLAYER_COLORS = ["#2dd4bf", "#60a5fa", "#f59e0b", "#a855f7"];

/** 1–2 char initials from a free-text name (falls back to "?"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
