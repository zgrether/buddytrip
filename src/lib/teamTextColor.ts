/**
 * teamTextColor — the ONE source of truth for "what text/icon color is readable
 * on this team-color background?" Every place that paints text or an icon ON a
 * team color (the #551 avatars, the match-status margin, the rack score block, …)
 * reads this, so contrast can't be re-decided (or forgotten) per site.
 *
 * COMPUTED, not per-color: it picks whichever of the dark or light foreground has
 * the higher WCAG contrast ratio against the given background (max-contrast — the
 * standard crossover). Robust to any hex, including future team colors. Some team
 * colors are light (bright green / cyan / amber / orange) where white fails; this
 * flips them to dark automatically. Unparseable input → white (safe on the app's
 * dark surfaces).
 *
 * The two foregrounds are the app's tokens: dark = `--color-bt-on-accent`
 * (#0d1f1a, the same dark used on teal fills), light = white.
 */

/** Dark foreground for LIGHT team colors (the app's on-accent dark). */
export const TEAM_TEXT_DARK = "var(--color-bt-on-accent)";
/** Light foreground for DARK team colors. */
export const TEAM_TEXT_LIGHT = "#ffffff";
/** Relative luminance of TEAM_TEXT_DARK (#0d1f1a) — precomputed for the ratio. */
const DARK_LUMINANCE = 0.0114;

/** Parse a #rgb / #rrggbb hex into [r,g,b] (0–255), or null if unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB relative luminance (WCAG): linearize each channel, then weight. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two relative luminances (order-independent). */
function contrast(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The readable text/icon color for text placed ON `bgColor` (a team color).
 * Returns TEAM_TEXT_DARK or TEAM_TEXT_LIGHT — whichever contrasts more.
 */
export function teamTextColor(bgColor: string | null | undefined): string {
  if (!bgColor) return TEAM_TEXT_LIGHT;
  const rgb = parseHex(bgColor);
  if (!rgb) return TEAM_TEXT_LIGHT; // safe fallback (e.g. a CSS var / named color)
  const bgL = relativeLuminance(rgb[0], rgb[1], rgb[2]);
  const darkContrast = contrast(DARK_LUMINANCE, bgL);
  const whiteContrast = contrast(1, bgL); // white luminance = 1
  return darkContrast >= whiteContrast ? TEAM_TEXT_DARK : TEAM_TEXT_LIGHT;
}
