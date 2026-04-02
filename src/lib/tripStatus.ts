/**
 * Trip status utilities.
 *
 * Status is derived at read time — only 'saved' is explicitly stored in the DB.
 * planning/upcoming/past are computed from dates and destination lock state.
 */

import { parseLocalDate } from "@/lib/dates";

export type TripDisplayStatus = "planning" | "upcoming" | "past" | "saved";

interface TripStatusFields {
  start_date?: string | null;
  end_date?: string | null;
  locked_destination_title?: string | null;
  trip_status_override?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
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
 * - 'saved' — explicitly set by owner via mutation
 * - 'past' — derived: 3 days after end_date (no DB write)
 * - 'upcoming' — destination locked + start date set
 * - 'planning' — default
 */
export function getEffectiveStatus(trip: TripStatusFields): TripDisplayStatus {
  if (trip.trip_status_override === "saved") return "saved";

  if (trip.end_date) {
    const endDate = parseLocalDate(trip.end_date);
    const threeDaysAfter = addDays(endDate, 3);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (now > threeDaysAfter) return "past";
  }

  if (trip.locked_destination_title && trip.start_date) return "upcoming";
  return "planning";
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
