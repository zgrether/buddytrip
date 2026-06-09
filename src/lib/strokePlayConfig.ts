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
export const STROKE_PLAY_UNITS: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
}));

// Player identity palette (identity colors, not theme tokens — sanctioned like
// team colors per STYLE_GUIDE §7).
export const PLAYER_COLORS = ["#2dd4bf", "#60a5fa", "#f59e0b", "#a855f7"];

/** 1–2 char initials from a free-text name (falls back to "?"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
