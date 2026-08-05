/**
 * GolfCard score-color system (Slice C §1). Pure — classifies a gross score
 * relative to par and supplies the Traditional palette (LOCKED).
 *
 * Under par = warm, over par = cool, par = neutral. Par stays neutral on purpose
 * — green is reserved for leading/winning (place-1), and par is the most common
 * result, so a green par would make the whole card glow. These score colors live
 * OUTSIDE the button-token system (like team/vote colors) and must never read as
 * interactive — the number is RINGED, never on a solid-filled cell. Teal
 * (`--color-bt-accent`) is reserved for controls; never a score.
 */

export type GolfResult = "eagle" | "birdie" | "par" | "bogey" | "double";

/** 'double' covers +2 or worse (triple+ too). */
export function golfResult(gross: number | null | undefined, par: number): GolfResult | null {
  if (gross == null) return null;
  const d = gross - par;
  if (d <= -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  return "double";
}

export interface GolfStyle {
  shape: "circle" | "square" | "none";
  ring: "double" | "single" | "none";
  fg: string; // number + ring
  bg: string; // cell tint
}

export const GOLF_STYLE: Record<GolfResult, GolfStyle> = {
  eagle: { shape: "circle", ring: "double", fg: "#fcd34d", bg: "rgba(251,191,36,0.22)" },
  birdie: { shape: "circle", ring: "single", fg: "#fca5a5", bg: "rgba(248,113,113,0.18)" },
  par: { shape: "none", ring: "none", fg: "var(--color-bt-text)", bg: "transparent" },
  bogey: { shape: "square", ring: "single", fg: "#93c5fd", bg: "rgba(96,165,250,0.16)" },
  double: { shape: "square", ring: "double", fg: "#c4b5fd", bg: "rgba(139,92,246,0.20)" },
};

/**
 * The NAME of a score relative to par — deliberately NOT derived from
 * `GolfResult`, which is a STYLE bucket.
 *
 * `golfResult` groups −2-or-better as `eagle` and +2-or-worse as `double` so the
 * card has a bounded palette, and that grouping is correct for colour. Naming
 * through it made the buckets speak: a triple announced itself as "Double", and
 * an albatross as "Eagle". With a stroke in play the row shows gross and net side
 * by side, which put both errors on screen at once — "Double · net Double" for a
 * triple that nets to a double, "Eagle · net Eagle" for an eagle that nets to an
 * albatross. Each figure was already computed independently; they only *read* as
 * echoes because two different scores share one bucket's word.
 *
 * So the name comes from the difference itself, and stops where the real names
 * stop. Beyond +3 and below −3 there is no name worth printing — golf has words
 * for those, but nobody uses them, and inventing one is worse than saying
 * nothing. null means "no name", which reads the same as unscored to callers
 * that already handle it.
 */
export function golfWord(gross: number | null | undefined, par: number): string | null {
  if (gross == null) return null;
  const d = gross - par;
  if (d === -3) return "Albatross";
  if (d === -2) return "Eagle";
  if (d === -1) return "Birdie";
  if (d === 0) return "Par";
  if (d === 1) return "Bogey";
  if (d === 2) return "Double";
  if (d === 3) return "Triple";
  return null; // −4 or better, +4 or worse: unnamed on purpose
}
