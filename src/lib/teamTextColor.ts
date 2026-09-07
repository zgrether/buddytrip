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

/**
 * teamInk — a team colour used AS TEXT, on a card.
 *
 * `teamTextColor` above answers the fill question: what reads ON a team colour.
 * This is the other one, and it was missing: the team colour itself as ink. The
 * eight identity hues measure 2.15–3.96 : 1 on a white card — amber `#f59e0b`
 * at 2.15 and cyan `#06b6d4` at 2.43 are the worst — so a team name or score
 * painted in its own colour is barely there in light mode.
 *
 * DERIVED, never stored. `teams.color_dim` exists, is routed through three
 * routers, and is rendered nowhere; it is a set of near-black tints that only
 * make sense on a dark card, and as ink on white it would erase the identity
 * entirely, which is the whole point of the colour. Do not reach for it.
 *
 * The darkening is CSS rather than arithmetic so it needs no theme hook and
 * cannot flash on hydration: `color-mix` scales toward black in sRGB, which
 * preserves hue exactly, and `--color-bt-team-ink` carries the amount —
 * **67% in light** (the weakest value that clears 4.5 : 1 for all eight, amber
 * landing at 4.53) and **100% in dark**, where `color-mix` returns the colour
 * untouched. There is no dark delta.
 *
 * Pass any CSS colour; the result is a `color-mix()` expression.
 */
export function teamInk(color: string): string {
  return `color-mix(in srgb, ${color} var(--color-bt-team-ink), black)`;
}
