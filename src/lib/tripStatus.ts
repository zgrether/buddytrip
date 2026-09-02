/**
 * Trip status utilities.
 *
 * There is no stored stage. A trip's status is derived entirely from two
 * things: whether a destination has been locked (`locked_destination_at`)
 * and the trip's dates. The lifecycle is:
 *
 *   idea      — no destination locked yet
 *   upcoming  — destination locked, trip in the future (or dates TBD)
 *   now       — within 3 days of the start date, or mid-trip
 *   past       — more than 3 days after the end date
 *
 * Do not add date-fns or any date library — use these helpers.
 * Extend this file if a new date utility is needed.
 */

import { parseLocalDate } from "@/lib/dates";

export type TripDisplayStatus = "idea" | "upcoming" | "now" | "past";

export interface TripStatusFields {
  start_date?: string | null;
  end_date?: string | null;
  /** A destination is locked once this timestamp is set — the trip has
   *  moved out of the idea phase and into its date-driven lifecycle. */
  locked_destination_at?: string | null;
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
 * Priority (must stay in sync with the trip_status() SQL function):
 * 1. 'past'     — more than 3 days after end_date
 * 2. 'idea'     — no destination locked yet
 * 3. 'now'      — within 3 days of start_date (or mid-trip)
 * 4. 'upcoming' — destination locked, trip still ahead (or dates TBD)
 */
export function getEffectiveStatus(trip: TripStatusFields): TripDisplayStatus {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Past: 3 days after end_date — date-driven, independent of destination.
  if (trip.end_date) {
    const endDate = parseLocalDate(trip.end_date);
    const pastThreshold = addDays(endDate, 3);
    if (now > pastThreshold) return "past";
  }

  // Idea: no destination locked.
  if (!trip.locked_destination_at) return "idea";

  // Now: within 3 days of start (or past start).
  if (trip.start_date) {
    const startDate = parseLocalDate(trip.start_date);
    const nowThreshold = subDays(startDate, 3);
    if (now >= nowThreshold) return "now";
  }

  return "upcoming";
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

/**
 * May this viewer reach TRIP SETTINGS — the surface that can clear the lock?
 *
 * ── The invariant, and why it needs a name ──────────────────────────────────
 * `isReadOnly` is derived from `end_date`, and the only place an owner can
 * change `end_date` is trip settings (`TripSettingsModal` → `trips.lockDates`)
 * or the dates sheet. So gating settings on `!isReadOnly` makes the lock a
 * ONE-WAY DOOR: the trip crosses the threshold, the gear disappears, and the
 * one control that could move the date back out of range goes with it.
 *
 * That is exactly CLAUDE.md's refusal rule from the other side — "if the fix
 * requires a surface the reader's role cannot reach, the refusal itself is the
 * bug". The banner says "This trip is read-only" and, before this, named no way
 * out and offered none.
 *
 * The door was only ever ajar by accident: `onOpenDatesSheet` is gated on the
 * RAW `canEdit` rather than the read-only-adjusted one, so the dates sheet
 * stayed reachable while the gear did not. Two controls over one question,
 * disagreeing — this makes the reachable one deliberate instead of lucky.
 *
 * NOT a widening of who may edit. Ownership still decides, and the read-only
 * lock still holds over every CONTENT surface (`effectiveCanEdit`, and the
 * per-tab `isOwner` suppression). All this says is that the owner keeps the
 * escape hatch, so a finished trip can be reopened rather than being frozen for
 * good the first time it ages past the threshold.
 */
export function canReachTripSettings(
  _trip: TripStatusFields,
  viewer: { isOwner: boolean }
): boolean {
  // Deliberately does NOT consult `isReadOnly(_trip)`. The parameter is kept so
  // the call site reads as a decision about THIS trip, and so a future rule that
  // genuinely depends on the trip has somewhere to live — but a read-only trip
  // must never be the reason an owner cannot open settings.
  return viewer.isOwner;
}
