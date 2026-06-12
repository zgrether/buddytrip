/**
 * Handicap read path + hint deriver (Slice C, Mode A) — PURE, client-safe.
 *
 * A handicap is an integer 0–18 per participant (0 = scratch; 18 is a hard cap —
 * strokes-above-18 allocation is deferred, the cap absorbs blowups). Net is
 * computed downstream (`net = gross − strokeHoles(strokes, index)`); this module
 * only resolves the stroke count and describes where it lands.
 */

import { strokeHoles } from "./matchPlay";

export const MAX_STROKES = 18;

/** Clamp an arbitrary number to a valid handicap (0–18 integer). */
export function clampStrokes(n: number): number {
  return Math.min(MAX_STROKES, Math.max(0, Math.round(n)));
}

/**
 * THE single read path for a participant's effective strokes. Every net/standings
 * computation reads through this — never inline `?? 0` at a call site.
 *
 * Today it reads the game layer only. When competition- and profile-level
 * handicaps land, this becomes `game ?? competition ?? profile` — a change HERE,
 * not at every consumer. Keep it the one chokepoint.
 */
export function effectiveStrokes(participant: { handicap_strokes?: number | null }): number {
  return clampStrokes(participant.handicap_strokes ?? 0);
}

/**
 * Per-row "where strokes land" hint (§4) — derived, display-only, and ALWAYS in
 * agreement with `strokeHoles` (it's computed from it). Collapses high counts so
 * the list stays useful, and only names holes when a real (non-sequential) index
 * is present — mirroring the GolfCard INDEX row.
 *
 * - 0 strokes → null (no hint).
 * - strokes ≥ holeCount → "a stroke on every hole".
 * - no index passed → bare "N strokes" (no hole promise).
 * - sequential index (no real course index) → "N strokes · first N holes".
 * - real index, ≤9 → "N strokes · holes a, b, c" (the struck holes).
 * - real index, >9 → "N strokes · all but holes x, y" (the easiest unstruck).
 */
export function strokeHint(strokes: number, holeCount: number, strokeIndex?: number[] | null): string | null {
  if (strokes <= 0) return null;
  if (strokes >= holeCount) return "a stroke on every hole";
  if (!strokeIndex) return `${strokes} strokes`;

  const struck = [...strokeHoles(strokes, strokeIndex)].sort((a, b) => a - b);
  const isSequential = struck.every((h, i) => h === i + 1);
  if (isSequential) return `${strokes} strokes · first ${strokes} holes`;
  if (strokes <= 9) return `${strokes} strokes · holes ${struck.join(", ")}`;

  const struckSet = new Set(struck);
  const unstruck = Array.from({ length: holeCount }, (_, i) => i + 1).filter((h) => !struckSet.has(h));
  return `${strokes} strokes · all but holes ${unstruck.join(", ")}`;
}
