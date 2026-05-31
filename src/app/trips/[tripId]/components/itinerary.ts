/**
 * Itinerary aggregation utilities.
 *
 * Takes the trip's confirmed schedule items, confirmed lodging items, and
 * shared member arrivals, and produces a unified, sorted timeline of typed
 * events used by the Home tab's ItineraryPanel.
 *
 * Pure functions only — no React, no tRPC. Easy to unit-test.
 */

// ── Input shapes (subset of router responses) ─────────────────────────────

export interface ItineraryScheduleItem {
  id: string;
  item_type: "general" | "golf";
  title: string;
  detail?: string | null;
  scheduled_date?: string | null; // YYYY-MM-DD
  scheduled_time?: string | null; // HH:MM
  is_confirmed: boolean;
  sort_order: number;
  course_name?: string | null;
  course_location?: string | null;
  tee_times?: string[] | null;
  competition_events?: Array<{ id: string; title: string; type: string }> | null;
}

export interface ItineraryLogisticsItem {
  id: string;
  type: "lodging" | "transport" | "general";
  label: string;
  property_name?: string | null;
  address?: string | null;
  /** Stored as text; treated as YYYY-MM-DD by the rest of the app. */
  check_in_time?: string | null;
  check_out_time?: string | null;
  /** Optional clock time in HH:MM (24h) — surfaced on the itinerary. */
  check_in_time_of_day?: string | null;
  check_out_time_of_day?: string | null;
  is_confirmed?: boolean | null;
}

export interface ItineraryTripMember {
  memberId: string;
  displayName: string;
  travel_mode?: "driving" | "flying" | "other" | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_arrival_time?: string | null; // ISO timestamptz
  flight_airport?: string | null;
  travel_shared?: boolean | null;
  /** Guest (placeholder) members can't share their own travel — exclude them. */
  isGuest?: boolean | null;
  user?: { name?: string | null; avatar_icon?: string | null } | null;
}

// ── Output shape ──────────────────────────────────────────────────────────

export type ItineraryEvent =
  | {
      kind: "schedule";
      id: string;
      date: string;
      time: string | null;
      title: string;
      subtitle?: string | null;
      /** When set, the EventCard renders a "Map →" link that opens this in Google Maps. */
      address?: string | null;
      itemType: "general" | "golf";
      sortOrder: number;
      /** Golf only. null = no tee times set; [] = walk-on; [...] = specific times. */
      teeTimes?: string[] | null;
      /** Competition events linked to this agenda item. */
      competitionEvents?: Array<{ id: string; title: string; type: string }> | null;
    }
  | {
      kind: "lodging-checkin" | "lodging-checkout";
      id: string;
      date: string;
      /** HH:MM if the user provided check-in/out clock time, otherwise null. */
      time: string | null;
      title: string;
      subtitle?: string | null;
      address?: string | null;
    }
  | {
      kind: "arrival";
      id: string;
      date: string;
      time: string | null;
      title: string;
      subtitle?: string | null;
      memberId: string;
      displayName: string;
      avatarIcon?: string | null;
      isGuest?: boolean | null;
    };

// ── Helpers ───────────────────────────────────────────────────────────────

/** Today's date in the user's local timezone, as YYYY-MM-DD. */
export function todayLocalISO(now: Date = new Date()): string {
  // 'en-CA' produces ISO-shaped date strings (YYYY-MM-DD).
  return now.toLocaleDateString("en-CA");
}

/**
 * Parse the date portion of a YYYY-MM-DD or full ISO timestamp.
 * Returns the YYYY-MM-DD portion in the user's local timezone.
 */
function localDateOfTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-CA");
}

/** Parse the local HH:MM portion of a full ISO timestamp. */
function localTimeOfTimestamp(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Looks like a YYYY-MM-DD date string. */
function isDateString(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
}

/** Returns HH:MM if the input is a valid HH:MM (or HH:MM:SS) string, otherwise null. */
function normalizeTimeOfDay(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

// ── Core: buildItinerary ──────────────────────────────────────────────────

export function buildItinerary(input: {
  scheduleItems: ItineraryScheduleItem[];
  logisticsItems: ItineraryLogisticsItem[];
  members: ItineraryTripMember[];
}): ItineraryEvent[] {
  const events: ItineraryEvent[] = [];

  // ── 1. Confirmed schedule items ──
  for (const item of input.scheduleItems) {
    if (!item.is_confirmed) continue;
    if (!isDateString(item.scheduled_date)) continue;

    const subtitleParts: string[] = [];
    if (item.item_type === "golf") {
      // Title is already the course name — subtitle shows the address only.
      if (item.course_location) subtitleParts.push(item.course_location);
    } else if (item.detail) {
      subtitleParts.push(item.detail);
    }

    // Map link target — golf items have a course_location to navigate to.
    // General items have a free-form `detail` field that's usually a note,
    // not an address, so we don't surface a map link for those.
    const address =
      item.item_type === "golf" && item.course_location
        ? item.course_location
        : null;

    // For golf, use the earliest tee time (if any) as the sort/display time.
    const golfTime =
      item.item_type === "golf" && item.tee_times?.length
        ? item.tee_times.slice().sort()[0].slice(0, 5)
        : null;

    events.push({
      kind: "schedule",
      id: item.id,
      date: item.scheduled_date.slice(0, 10),
      time: golfTime ?? (item.scheduled_time ? item.scheduled_time.slice(0, 5) : null),
      title: item.title,
      subtitle: subtitleParts.join(" · ") || null,
      address,
      itemType: item.item_type,
      sortOrder: item.sort_order,
      teeTimes: item.item_type === "golf" ? (item.tee_times ?? null) : undefined,
      competitionEvents: item.competition_events?.length ? item.competition_events : null,
    });
  }

  // ── 2. Confirmed lodging — emit check-in + check-out events ──
  for (const item of input.logisticsItems) {
    if (item.type !== "lodging") continue;
    if (!item.is_confirmed) continue;

    const name = item.property_name ?? item.label ?? "Lodging";
    const subtitle = item.address ?? null;

    if (isDateString(item.check_in_time)) {
      events.push({
        kind: "lodging-checkin",
        id: `${item.id}-checkin`,
        date: item.check_in_time.slice(0, 10),
        time: normalizeTimeOfDay(item.check_in_time_of_day),
        title: `Check in: ${item.label || name}`,
        subtitle,
        address: item.address ?? null,
      });
    }
    if (isDateString(item.check_out_time)) {
      events.push({
        kind: "lodging-checkout",
        id: `${item.id}-checkout`,
        date: item.check_out_time.slice(0, 10),
        time: normalizeTimeOfDay(item.check_out_time_of_day),
        title: `Check out: ${item.label || name}`,
        subtitle,
        address: item.address ?? null,
      });
    }
  }

  // ── 3. Member arrivals ──
  // Travel is opt-in by entering it — there's no separate "shared" flag.
  // Anyone (real member or owner-logged placeholder) weaves in once they
  // have a mode + an arrival time.
  for (const m of input.members) {
    if (!m.travel_mode) continue;
    if (!m.flight_arrival_time) continue;

    const date = localDateOfTimestamp(m.flight_arrival_time);
    const time = localTimeOfTimestamp(m.flight_arrival_time);

    // `travel_detail` is the single free-text description for every mode.
    // Fall back to the legacy structured flight fields for older rows that
    // predate the collapse to one detail string.
    let subtitle: string | null = m.travel_detail ?? null;
    if (!subtitle && m.travel_mode === "flying") {
      const flight = [m.flight_airline, m.flight_number].filter(Boolean).join(" ");
      const parts: string[] = [];
      if (flight) parts.push(flight);
      if (m.flight_airport) parts.push(`arriving ${m.flight_airport}`);
      subtitle = parts.join(" · ") || null;
    }

    events.push({
      kind: "arrival",
      id: `arrival-${m.memberId}`,
      date,
      time,
      title: `${m.displayName} arrives`,
      subtitle,
      memberId: m.memberId,
      displayName: m.displayName,
      avatarIcon: m.user?.avatar_icon ?? null,
      isGuest: m.isGuest ?? false,
    });
  }

  events.sort(compareEvents);
  return events;
}

// ── Sorting ───────────────────────────────────────────────────────────────

const KIND_PRIORITY: Record<ItineraryEvent["kind"], number> = {
  "lodging-checkout": 0,
  arrival: 1,
  "lodging-checkin": 2,
  schedule: 3,
};

function compareEvents(a: ItineraryEvent, b: ItineraryEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;

  // Null times sort *after* timed events on the same day.
  if (a.time !== b.time) {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time < b.time ? -1 : 1;
  }

  const kindDelta = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  if (kindDelta !== 0) return kindDelta;

  if (a.kind === "schedule" && b.kind === "schedule") {
    return a.sortOrder - b.sortOrder;
  }
  return 0;
}

// ── Grouping ──────────────────────────────────────────────────────────────

export interface ItineraryDay {
  date: string;
  events: ItineraryEvent[];
}

export function groupByDay(events: ItineraryEvent[]): ItineraryDay[] {
  const map = new Map<string, ItineraryEvent[]>();
  for (const e of events) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, events]) => ({ date, events }));
}

/** Bucket grouped days into past / today / upcoming. */
export function bucketDays(
  days: ItineraryDay[],
  today: string = todayLocalISO()
): { past: ItineraryDay[]; today: ItineraryDay | null; upcoming: ItineraryDay[] } {
  const past: ItineraryDay[] = [];
  const upcoming: ItineraryDay[] = [];
  let todayDay: ItineraryDay | null = null;
  for (const d of days) {
    if (d.date < today) past.push(d);
    else if (d.date === today) todayDay = d;
    else upcoming.push(d);
  }
  return { past, today: todayDay, upcoming };
}

// ── Happening-now detection ───────────────────────────────────────────────

/**
 * Returns true when an event is within ±60 minutes of `now`. Events without a
 * time component never qualify (we don't know when in the day they occur).
 */
export function isHappeningNow(
  dateISO: string,
  timeHHMM: string | null,
  now: Date = new Date()
): boolean {
  if (!timeHHMM) return false;
  const [hStr, mStr] = timeHHMM.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;

  // Build a Date in local time at the given date + time.
  const [yStr, moStr, dStr] = dateISO.split("-");
  const eventDate = new Date(
    parseInt(yStr, 10),
    parseInt(moStr, 10) - 1,
    parseInt(dStr, 10),
    h,
    m,
    0,
    0
  );
  if (Number.isNaN(eventDate.getTime())) return false;

  const diffMs = Math.abs(eventDate.getTime() - now.getTime());
  return diffMs <= 60 * 60 * 1000;
}

/** Compute the "Day N" label index for a date relative to a trip start date. */
export function dayNumber(date: string, tripStart: string | null): number | null {
  if (!tripStart) return null;
  const [sy, sm, sd] = tripStart.slice(0, 10).split("-").map((n) => parseInt(n, 10));
  const [dy, dm, dd] = date.slice(0, 10).split("-").map((n) => parseInt(n, 10));
  const start = new Date(sy, sm - 1, sd, 12, 0, 0, 0).getTime();
  const day = new Date(dy, dm - 1, dd, 12, 0, 0, 0).getTime();
  return Math.floor((day - start) / 86400000) + 1;
}
