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

const WORDS: Record<GolfResult, string> = {
  eagle: "Eagle",
  birdie: "Birdie",
  par: "Par",
  bogey: "Bogey",
  double: "Double",
};

/** Golf word for a gross score vs par (e.g. "Birdie"). null when unscored. */
export function golfWord(gross: number | null | undefined, par: number): string | null {
  const r = golfResult(gross, par);
  return r ? WORDS[r] : null;
}

export function golfWordFor(result: GolfResult): string {
  return WORDS[result];
}
