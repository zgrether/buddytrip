/**
 * Curated gradient palette for idea cards.
 * Hand-picked hues that look good as card header gradients.
 * Avoids muddy browns/olives (hue 30-60°) that hashToHue can produce.
 */
const IDEA_GRADIENTS = [
  { h1: 210, h2: 230 }, // deep blue
  { h1: 160, h2: 180 }, // teal
  { h1: 270, h2: 290 }, // purple
  { h1: 340, h2: 360 }, // rose
  { h1: 140, h2: 165 }, // forest
  { h1: 195, h2: 220 }, // ocean
  { h1: 300, h2: 320 }, // magenta
  { h1: 20, h2: 40 }, // warm amber
];

export function ideaGradient(index: number, isDark: boolean): string {
  const { h1, h2 } = IDEA_GRADIENTS[index % IDEA_GRADIENTS.length];
  return isDark
    ? `linear-gradient(160deg, hsl(${h1}, 50%, 22%) 0%, hsl(${h2}, 40%, 12%) 100%)`
    : `linear-gradient(160deg, hsl(${h1}, 55%, 92%) 0%, hsl(${h2}, 45%, 85%) 100%)`;
}
