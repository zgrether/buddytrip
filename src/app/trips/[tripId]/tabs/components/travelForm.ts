/**
 * Pure travel form <-> payload helpers (arrival + departure legs).
 *
 * No React / tRPC / DB — kept separate from the "use client" TravelControls so
 * the form logic is unit-testable and shared by the display surfaces
 * (CrewRoster, MemberEditor, itinerary prefill). The two legs are independent:
 * a member may set an arrival, a departure, both, or neither.
 */

export type TravelMode = "driving" | "flying" | "other";

/** Minimum member shape the travel controls read for prefill + display. */
export interface TravelMember {
  travel_mode?: string | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_airport?: string | null;
  flight_arrival_time?: string | null;
  /** Departure leg — mirror of the arrival fields (migration 080). */
  departure_mode?: string | null;
  departure_detail?: string | null;
  departure_time?: string | null;
}

// ── Display helpers ─────────────────────────────────────────────────────────

/** Detail line for a member's saved (arrival) travel — the single detail
 *  string, with a graceful fallback to legacy flight fields for older rows.
 *  Empty → null. */
export function summarizeTravel(m: TravelMember): string | null {
  if (m.travel_detail) return m.travel_detail;
  // Legacy fallback: structured flight fields from before the detail collapse.
  if (m.travel_mode === "flying") {
    const flight = [m.flight_airline, m.flight_number].filter(Boolean).join(" ");
    const parts: string[] = [];
    if (flight) parts.push(flight);
    if (m.flight_airport) parts.push(`arriving ${m.flight_airport}`);
    return parts.join(" · ") || null;
  }
  return null;
}

/**
 * Render an ISO timestamp as "Sep 10 · 3:00 PM" — or just "Sep 10" when there's
 * no specific time (date-only entries store midnight as the sentinel). Used for
 * both arrival and departure timestamps.
 *
 * Read literally (TZ-naive): the stored value is a `timestamptz` and running it
 * through `new Date()` would shift it into the viewer's local zone, landing the
 * label on the wrong day. We format directly off the date/time prefix instead.
 */
export function formatArrivalLabel(iso: string | null | undefined): string {
  const date = parseArrivalDate(iso);
  if (!date) return "";
  const time = parseArrivalTime(iso); // "" when midnight / no time

  const [y, mo, da] = date.split("-").map(Number);
  const dateLabel = new Date(y, mo - 1, da).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  if (!time) return dateLabel;
  const [hh, mm] = time.split(":").map(Number);
  const timeLabel = new Date(2000, 0, 1, hh, mm).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateLabel} · ${timeLabel}`;
}

/** Pull YYYY-MM-DD out of an ISO timestamp, read literally (TZ-naive). */
export function parseArrivalDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * Pull HH:MM out of an ISO timestamp, read literally (TZ-naive).
 *
 * Returns "" for missing times and for exactly midnight — midnight is our
 * sentinel for "date only, no specific time", so re-opening the editor on a
 * date-only entry shows an empty time field rather than a spurious 12:00 AM.
 */
export function parseArrivalTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  const hhmm = `${m[1]}:${m[2]}`;
  return hhmm === "00:00" ? "" : hhmm;
}

// ── Form state ──────────────────────────────────────────────────────────────

export interface TravelFormValue {
  /** `null` = no mode picked yet (the segmented control sits unselected).
   *  Arrival mode is the "has arrival" marker — saving with a null mode
   *  persists *no* arrival rather than silently defaulting to a mode. */
  mode: TravelMode | null;
  detail: string;
  arrivalDate: string;
  arrivalTime: string;
  /** Departure leg — independent of arrival. */
  departureMode: TravelMode | null;
  departureDetail: string;
  departureDate: string;
  departureTime: string;
}

/** Build the initial form value from a member's saved travel (with legacy
 *  flight-field fallback for older flying rows). A member with no saved travel
 *  starts with both modes `null` so the segmented controls open unselected. */
export function travelMemberToForm(member: TravelMember): TravelFormValue {
  return {
    mode: (member.travel_mode as TravelMode) ?? null,
    detail: summarizeTravel(member) ?? "",
    arrivalDate: parseArrivalDate(member.flight_arrival_time),
    arrivalTime: parseArrivalTime(member.flight_arrival_time),
    departureMode: (member.departure_mode as TravelMode) ?? null,
    departureDetail: member.departure_detail ?? "",
    departureDate: parseArrivalDate(member.departure_time),
    departureTime: parseArrivalTime(member.departure_time),
  };
}

/** Payload that wipes a member's travel entirely — both legs, no detail, no
 *  timestamps, and the legacy flight columns cleared too. Used by the Clear /
 *  reset action on both travel surfaces. */
export const TRAVEL_CLEAR_PAYLOAD = {
  travelMode: null,
  travelDetail: null,
  flightAirline: null,
  flightNumber: null,
  flightArrivalTime: null,
  flightAirport: null,
  departureMode: null,
  departureDetail: null,
  departureTime: null,
} as const;

/** Convert form state into the mutation payload. Clears the legacy structured
 *  flight columns on every save so the single detail string stays authoritative.
 *
 *  Each leg is INDEPENDENT: a null arrival mode records no arrival (and clears
 *  its columns) but leaves the departure leg intact, and vice-versa. The mode
 *  is the per-leg marker the crew roster + itinerary key off, so a
 *  detail/date without a mode would be invisible orphan data — we drop it. A
 *  wholly-untouched form (both modes null) therefore persists no travel rather
 *  than silently saving "Flying". */
export function travelFormToPayload(value: TravelFormValue) {
  const legISO = (date: string, time: string): string | null => {
    if (!date) return null;
    return time ? `${date}T${time}:00` : `${date}T00:00:00`;
  };
  return {
    travelMode: value.mode,
    travelDetail: value.mode ? value.detail.trim() || null : null,
    flightAirline: null,
    flightNumber: null,
    flightArrivalTime: value.mode ? legISO(value.arrivalDate, value.arrivalTime) : null,
    flightAirport: null,
    departureMode: value.departureMode,
    departureDetail: value.departureMode ? value.departureDetail.trim() || null : null,
    departureTime: value.departureMode
      ? legISO(value.departureDate, value.departureTime)
      : null,
  };
}

/** Field-by-field equality so callers can tell whether the form is dirty. */
export function travelFormsEqual(a: TravelFormValue, b: TravelFormValue): boolean {
  return (
    a.mode === b.mode &&
    a.detail.trim() === b.detail.trim() &&
    a.arrivalDate === b.arrivalDate &&
    a.arrivalTime === b.arrivalTime &&
    a.departureMode === b.departureMode &&
    a.departureDetail.trim() === b.departureDetail.trim() &&
    a.departureDate === b.departureDate &&
    a.departureTime === b.departureTime
  );
}
