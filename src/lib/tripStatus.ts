/**
 * Trip status utilities.
 *
 * Trips have a stored `stage` column: 'idea' → 'planning' → 'going'.
 * Temporal substates ('now', 'past') are derived at read time from dates.
 * 'saved' is an explicit owner override via trip_status_override.
 *
 * Do not add date-fns or any date library — use these helpers.
 * Extend this file if a new date utility is needed.
 */

import { parseLocalDate } from "@/lib/dates";

export type TripDisplayStatus =
  | "idea"
  | "planning"
  | "going"
  | "now"
  | "past"
  | "saved";

export interface TripStatusFields {
  stage?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_title?: string | null;
  trip_status_override?: string | null;
}

// ── Date helpers ─────────────────────────────────────────────────────────
// Do not add date-fns — extend these helpers instead.

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function subDays(date: Date, days: number): Date {
  return addDays(date, -days);
}

export function differenceInDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Get the next Sunday on or after the given date.
 * If the date is already a Sunday, returns the same date.
 */
function nextSunday(date: Date): Date {
  const day = date.getDay(); // 0 = Sunday
  if (day === 0) return date;
  return addDays(date, 7 - day);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Compute the effective display status for a trip.
 *
 * Priority:
 * 1. 'saved' — explicitly set by owner
 * 2. 'past' — 3 days after end_date
 * 3. 'now' — going stage, within 3 days of start_date (or past start)
 * 4. 'going' — stage is going
 * 5. 'planning' — stage is planning
 * 6. 'idea' — default
 */
export function getEffectiveStatus(trip: TripStatusFields): TripDisplayStatus {
  if (trip.trip_status_override === "saved") return "saved";

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Past: 3 days after end_date
  if (trip.end_date) {
    const endDate = parseLocalDate(trip.end_date);
    const pastThreshold = addDays(endDate, 3);
    if (now > pastThreshold) return "past";
  }

  const stage = trip.stage ?? "idea";

  // Now: going stage + within 3 days of start (or past start)
  if (stage === "going" && trip.start_date) {
    const startDate = parseLocalDate(trip.start_date);
    const nowThreshold = subDays(startDate, 3);
    if (now >= nowThreshold) return "now";
  }

  if (stage === "going") return "going";
  if (stage === "planning") return "planning";
  return "idea";
}

/**
 * Countdown label for NOW stage trips.
 * Returns "3 days to go", "Tomorrow", "Today", or null.
 */
export function countdownLabel(trip: TripStatusFields): string | null {
  if (getEffectiveStatus(trip) !== "now") return null;
  const startDate = trip.start_date ? parseLocalDate(trip.start_date) : null;
  if (!startDate) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (now >= startDate) return null; // trip has started

  const days = differenceInDays(startDate, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days to go`;
}

/**
 * Whether the trip should be shown in grayscale on the dashboard.
 *
 * Threshold: end_date + 14 days, rounded up to the next Sunday.
 */
export function isGrayscale(trip: TripStatusFields): boolean {
  if (!trip.end_date) return false;
  const endDate = parseLocalDate(trip.end_date);
  const threshold = nextSunday(addDays(endDate, 14));
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now > threshold;
}

/**
 * Whether the trip is read-only (all edit actions locked).
 * Same threshold as grayscale. Chat remains open.
 */
export function isReadOnly(trip: TripStatusFields): boolean {
  return isGrayscale(trip);
}
