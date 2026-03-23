/**
 * Temporal gradient palette — encodes time-to-trip as color temperature.
 *
 * Close trips feel urgent/warm, far trips feel cool/distant, past trips
 * are muted. The color arc:
 *   past (slate) → just passed (amber) → imminent (red/orange) →
 *   soon (warm amber) → coming up (teal) → later (blue) → far future (purple)
 */

/** [maxDaysUntil, h1, s1, h2, s2] — first match wins */
const STOPS: Array<[number, number, number, number, number]> = [
  [-30,  220, 15, 220, 10],  // past — desaturated slate
  [  0,   35, 45,  25, 35],  // just passed — amber fade
  [ 30,   15, 60,   5, 50],  // imminent — red/orange
  [ 90,   40, 55,  30, 45],  // soon — warm amber
  [180,  165, 50, 185, 45],  // coming up — teal/green
  [365,  195, 50, 215, 45],  // later this year — cool blue
  [Infinity, 240, 40, 260, 35], // far future — purple
];

/**
 * Returns a CSS linear-gradient string based on how far away the trip
 * start date is. `tripDate` should be a Date or null/undefined (no date
 * set → neutral blue/teal).
 */
export function temporalGradient(
  tripDate: Date | string | null | undefined,
  isDark: boolean,
): string {
  if (!tripDate) {
    // No date set — neutral blue/teal
    return isDark
      ? "linear-gradient(160deg, hsl(210, 50%, 18%) 0%, hsl(185, 45%, 12%) 100%)"
      : "linear-gradient(160deg, hsl(210, 55%, 94%) 0%, hsl(185, 45%, 90%) 100%)";
  }

  const parsed = typeof tripDate === "string" ? new Date(tripDate) : tripDate;
  const daysUntil = (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  const [, h1, s1, h2, s2] = STOPS.find(([max]) => daysUntil <= max)!;

  return isDark
    ? `linear-gradient(160deg, hsl(${h1}, ${s1}%, 20%) 0%, hsl(${h2}, ${s2}%, 13%) 100%)`
    : `linear-gradient(160deg, hsl(${h1}, ${s1 + 10}%, 92%) 0%, hsl(${h2}, ${s2 + 5}%, 86%) 100%)`;
}

/**
 * Backward-compatible wrapper: falls back to index-based gradient when
 * no trip date is available (e.g. catalog cards with no trip context).
 * Uses the same curated hue palette as the old ideaGradient function.
 */
const IDEA_GRADIENTS = [
  { h1: 210, h2: 230 }, // deep blue
  { h1: 160, h2: 180 }, // teal
  { h1: 270, h2: 290 }, // purple
  { h1: 340, h2: 360 }, // rose
  { h1: 140, h2: 165 }, // forest
  { h1: 195, h2: 220 }, // ocean
  { h1: 300, h2: 320 }, // magenta
  { h1: 20, h2: 40 },   // warm amber
];

export function ideaGradient(index: number, isDark: boolean): string {
  const { h1, h2 } = IDEA_GRADIENTS[index % IDEA_GRADIENTS.length];
  return isDark
    ? `linear-gradient(160deg, hsl(${h1}, 50%, 22%) 0%, hsl(${h2}, 40%, 12%) 100%)`
    : `linear-gradient(160deg, hsl(${h1}, 55%, 92%) 0%, hsl(${h2}, 45%, 85%) 100%)`;
}
