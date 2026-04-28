import { describe, it, expect } from "vitest";
import {
  buildItinerary,
  groupByDay,
  bucketDays,
  isHappeningNow,
  todayLocalISO,
  dayNumber,
  type ItineraryScheduleItem,
  type ItineraryLogisticsItem,
  type ItineraryTripMember,
} from "./itinerary";

// ── Fixtures ──────────────────────────────────────────────────────────────

function scheduleItem(
  overrides: Partial<ItineraryScheduleItem> = {}
): ItineraryScheduleItem {
  return {
    id: "s1",
    item_type: "general",
    title: "Breakfast",
    detail: null,
    scheduled_date: "2026-06-15",
    scheduled_time: "08:00",
    is_confirmed: true,
    sort_order: 0,
    course_name: null,
    course_location: null,
    ...overrides,
  };
}

function lodgingItem(
  overrides: Partial<ItineraryLogisticsItem> = {}
): ItineraryLogisticsItem {
  return {
    id: "l1",
    type: "lodging",
    label: "Beach House",
    property_name: "Sleeps 8",
    address: "1 Ocean Dr",
    check_in_time: "2026-06-15",
    check_out_time: "2026-06-18",
    is_confirmed: true,
    ...overrides,
  };
}

function member(
  overrides: Partial<ItineraryTripMember> = {}
): ItineraryTripMember {
  return {
    memberId: "u1",
    displayName: "Alice",
    travel_mode: "flying",
    travel_detail: null,
    flight_airline: "United",
    flight_number: "UA123",
    flight_arrival_time: "2026-06-15T15:30:00Z",
    flight_airport: "ORD",
    travel_shared: true,
    user: null,
    ...overrides,
  };
}

// ── buildItinerary: filtering ─────────────────────────────────────────────

describe("buildItinerary — filtering", () => {
  it("excludes unconfirmed schedule items", () => {
    const events = buildItinerary({
      scheduleItems: [scheduleItem({ is_confirmed: false })],
      logisticsItems: [],
      members: [],
    });
    expect(events).toHaveLength(0);
  });

  it("excludes schedule items without a scheduled_date", () => {
    const events = buildItinerary({
      scheduleItems: [scheduleItem({ scheduled_date: null })],
      logisticsItems: [],
      members: [],
    });
    expect(events).toHaveLength(0);
  });

  it("includes lodging regardless of is_confirmed (compare/lock is a planning-stage concept)", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ is_confirmed: false })],
      members: [],
    });
    // Default lodgingItem helper has check_in_time + check_out_time → 2 events
    expect(events.length).toBeGreaterThan(0);
  });

  it("excludes non-lodging logistics items", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ type: "transport" })],
      members: [],
    });
    expect(events).toHaveLength(0);
  });

  it("excludes arrivals where travel_shared is false", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ travel_shared: false })],
    });
    expect(events).toHaveLength(0);
  });

  it("excludes arrivals without a flight_arrival_time", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ flight_arrival_time: null })],
    });
    expect(events).toHaveLength(0);
  });
});

// ── buildItinerary: lodging splitting ─────────────────────────────────────

describe("buildItinerary — lodging", () => {
  it("emits separate check-in and check-out events", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem()],
      members: [],
    });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("lodging-checkin");
    expect(kinds).toContain("lodging-checkout");
    expect(events).toHaveLength(2);
  });

  it("skips check-in event when check_in_time is missing without throwing", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ check_in_time: null })],
      members: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("lodging-checkout");
  });

  it("skips check-out event when check_out_time is missing", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ check_out_time: null })],
      members: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("lodging-checkin");
  });
});

// ── Sorting ───────────────────────────────────────────────────────────────

describe("buildItinerary — sorting", () => {
  it("sorts by date ascending across days", () => {
    const events = buildItinerary({
      scheduleItems: [
        scheduleItem({ id: "s1", scheduled_date: "2026-06-17", scheduled_time: "10:00" }),
        scheduleItem({ id: "s2", scheduled_date: "2026-06-15", scheduled_time: "10:00" }),
      ],
      logisticsItems: [],
      members: [],
    });
    expect(events.map((e) => e.id)).toEqual(["s2", "s1"]);
  });

  it("orders same-day events: checkout < arrival < checkin < schedule (when times tie)", () => {
    // All timeless / same time so kind priority is the deciding factor.
    const events = buildItinerary({
      scheduleItems: [
        scheduleItem({ id: "s1", scheduled_time: null }),
      ],
      logisticsItems: [
        lodgingItem({
          id: "l1",
          check_in_time: "2026-06-15",
          check_out_time: "2026-06-15",
        }),
      ],
      members: [
        member({ memberId: "u1", flight_arrival_time: null }),
      ],
    });
    // Arrival skipped (no time), so we should see checkout, checkin, schedule.
    expect(events.map((e) => e.kind)).toEqual([
      "lodging-checkout",
      "lodging-checkin",
      "schedule",
    ]);
  });

  it("breaks schedule ties by sort_order", () => {
    const events = buildItinerary({
      scheduleItems: [
        scheduleItem({ id: "s1", scheduled_time: "10:00", sort_order: 5 }),
        scheduleItem({ id: "s2", scheduled_time: "10:00", sort_order: 1 }),
      ],
      logisticsItems: [],
      members: [],
    });
    expect(events.map((e) => e.id)).toEqual(["s2", "s1"]);
  });

  it("places null-time events after timed events on the same day", () => {
    const events = buildItinerary({
      scheduleItems: [
        scheduleItem({ id: "s_null", scheduled_time: null }),
        scheduleItem({ id: "s_timed", scheduled_time: "09:00" }),
      ],
      logisticsItems: [],
      members: [],
    });
    expect(events.map((e) => e.id)).toEqual(["s_timed", "s_null"]);
  });
});

// ── groupByDay / bucketDays ───────────────────────────────────────────────

describe("groupByDay & bucketDays", () => {
  it("groups events by date and sorts the day buckets", () => {
    const events = buildItinerary({
      scheduleItems: [
        scheduleItem({ id: "s1", scheduled_date: "2026-06-15" }),
        scheduleItem({ id: "s2", scheduled_date: "2026-06-17" }),
        scheduleItem({ id: "s3", scheduled_date: "2026-06-15", scheduled_time: "12:00" }),
      ],
      logisticsItems: [],
      members: [],
    });
    const days = groupByDay(events);
    expect(days.map((d) => d.date)).toEqual(["2026-06-15", "2026-06-17"]);
    expect(days[0].events).toHaveLength(2);
    expect(days[1].events).toHaveLength(1);
  });

  it("buckets days into past, today, upcoming relative to a fixed today", () => {
    const days = groupByDay(
      buildItinerary({
        scheduleItems: [
          scheduleItem({ id: "p", scheduled_date: "2026-06-14" }),
          scheduleItem({ id: "t", scheduled_date: "2026-06-15" }),
          scheduleItem({ id: "u", scheduled_date: "2026-06-16" }),
        ],
        logisticsItems: [],
        members: [],
      })
    );
    const buckets = bucketDays(days, "2026-06-15");
    expect(buckets.past.map((d) => d.date)).toEqual(["2026-06-14"]);
    expect(buckets.today?.date).toBe("2026-06-15");
    expect(buckets.upcoming.map((d) => d.date)).toEqual(["2026-06-16"]);
  });
});

// ── isHappeningNow ────────────────────────────────────────────────────────

describe("isHappeningNow", () => {
  const baseNow = new Date(2026, 5, 15, 12, 0, 0); // June 15, 2026, 12:00 local

  it("returns true within ±60 minutes", () => {
    expect(isHappeningNow("2026-06-15", "11:30", baseNow)).toBe(true);
    expect(isHappeningNow("2026-06-15", "12:30", baseNow)).toBe(true);
    expect(isHappeningNow("2026-06-15", "12:00", baseNow)).toBe(true);
  });

  it("returns false outside ±60 minutes", () => {
    expect(isHappeningNow("2026-06-15", "10:30", baseNow)).toBe(false);
    expect(isHappeningNow("2026-06-15", "13:30", baseNow)).toBe(false);
  });

  it("returns false on a different day", () => {
    expect(isHappeningNow("2026-06-16", "12:00", baseNow)).toBe(false);
  });

  it("returns false when time is null (we don't know when in the day)", () => {
    expect(isHappeningNow("2026-06-15", null, baseNow)).toBe(false);
  });
});

// ── Misc helpers ──────────────────────────────────────────────────────────

describe("todayLocalISO", () => {
  it("returns a YYYY-MM-DD string in local time", () => {
    const result = todayLocalISO(new Date(2026, 5, 15, 23, 59));
    expect(result).toBe("2026-06-15");
  });
});

describe("dayNumber", () => {
  it("returns 1 for the trip start date", () => {
    expect(dayNumber("2026-06-15", "2026-06-15")).toBe(1);
  });

  it("counts subsequent days correctly", () => {
    expect(dayNumber("2026-06-17", "2026-06-15")).toBe(3);
  });

  it("returns null when tripStart is missing", () => {
    expect(dayNumber("2026-06-15", null)).toBeNull();
  });
});
