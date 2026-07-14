import { describe, it, expect } from "vitest";
import {
  buildItinerary,
  groupByDay,
  bucketDays,
  isHappeningNow,
  todayLocalISO,
  dayNumber,
  summarizeLodging,
  groupDayBlocks,
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
    title: "Beach House",
    sleeps: "Sleeps 8",
    address: "1 Ocean Dr",
    check_in_date: "2026-06-15",
    check_out_date: "2026-06-18",
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

describe("buildItinerary — schedule item location/map", () => {
  it("surfaces course_location as the map address for a general item with a place", () => {
    const [event] = buildItinerary({
      scheduleItems: [
        scheduleItem({
          item_type: "general",
          title: "Dinner",
          course_name: "The Ordinary",
          course_location: "544 King St, Charleston, SC",
        }),
      ],
      logisticsItems: [],
      members: [],
    });
    expect(event).toMatchObject({ kind: "schedule", address: "544 King St, Charleston, SC" });
  });

  it("leaves address null for a general item with no place", () => {
    const [event] = buildItinerary({
      scheduleItems: [scheduleItem({ item_type: "general", course_location: null })],
      logisticsItems: [],
      members: [],
    });
    expect(event).toMatchObject({ kind: "schedule", address: null });
  });
});

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

  it("excludes unconfirmed lodging", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ is_confirmed: false })],
      members: [],
    });
    expect(events).toHaveLength(0);
  });

  it("excludes non-lodging logistics items", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ type: "transport" })],
      members: [],
    });
    expect(events).toHaveLength(0);
  });

  it("weaves in arrivals regardless of travel_shared (flag no longer gates)", () => {
    // Travel is opt-in by entering it — there's no separate "shared" flag.
    // A member with a mode + arrival time weaves in even when travel_shared
    // is false (legacy rows) or undefined.
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ travel_shared: false })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("arrival");
  });

  it("carries the member's travel mode on the arrival event", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ travel_mode: "driving" })],
    });
    expect(events[0]).toMatchObject({ kind: "arrival", mode: "driving" });
  });

  it("excludes arrivals without a travel_mode", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ travel_mode: null })],
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

  it("uses travel_detail as the arrival subtitle for every mode", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          travel_mode: "driving",
          travel_detail: "Driving up from Charlotte",
          // No flight fields — detail is the single source of truth.
          flight_airline: null,
          flight_number: null,
          flight_airport: null,
        }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("arrival");
    if (events[0].kind === "arrival") {
      expect(events[0].subtitle).toBe("Driving up from Charlotte");
    }
  });

  it("falls back to legacy flight fields when travel_detail is empty", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          travel_mode: "flying",
          travel_detail: null,
          flight_airline: "United",
          flight_number: "UA123",
          flight_airport: "ORD",
        }),
      ],
    });
    expect(events).toHaveLength(1);
    if (events[0].kind === "arrival") {
      expect(events[0].subtitle).toBe("United UA123 · arriving ORD");
    }
  });

  it("treats a midnight arrival as date-only (time is null)", () => {
    // Date-only arrivals are stored as YYYY-MM-DDT00:00:00 — midnight is our
    // sentinel for "no specific time". The event still weaves in, dated, but
    // with a null time so it sorts to the end of the day.
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ flight_arrival_time: "2026-06-15T00:00:00Z" })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("arrival");
    expect(events[0].date).toBe("2026-06-15");
    expect(events[0].time).toBeNull();
  });

  it("reads the arrival date/time literally, with no timezone shift", () => {
    // The stored value is a timestamptz; parsing it through `new Date()` would
    // shift it into the runner's local zone and could land it on a different
    // calendar day or hour. We read the Y/M/D and H:M prefix verbatim.
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member({ flight_arrival_time: "2026-06-15T23:45:00Z" })],
    });
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-06-15");
    expect(events[0].time).toBe("23:45");
  });
});

// ── buildItinerary: departures (mirror of arrivals) ───────────────────────

describe("buildItinerary — departures", () => {
  it("emits a departure event on the departure date", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          // No arrival — departure-only member.
          travel_mode: null,
          flight_arrival_time: null,
          departure_mode: "flying",
          departure_detail: "Red-eye home",
          departure_time: "2026-09-13T22:15:00Z",
        }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "departure",
      date: "2026-09-13",
      time: "22:15",
      mode: "flying",
      subtitle: "Red-eye home",
    });
  });

  it("places arrival and departure on their own dates for one member", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          flight_arrival_time: "2026-09-09T15:30:00Z",
          departure_mode: "driving",
          departure_time: "2026-09-13T11:00:00Z",
        }),
      ],
    });
    const arrival = events.find((e) => e.kind === "arrival");
    const departure = events.find((e) => e.kind === "departure");
    expect(arrival?.date).toBe("2026-09-09");
    expect(departure?.date).toBe("2026-09-13");
  });

  it("excludes departures without a departure_mode", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          travel_mode: null,
          flight_arrival_time: null,
          departure_mode: null,
          departure_time: "2026-09-13T11:00:00Z",
        }),
      ],
    });
    expect(events).toHaveLength(0);
  });

  it("excludes departures without a departure_time", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          travel_mode: null,
          flight_arrival_time: null,
          departure_mode: "flying",
          departure_time: null,
        }),
      ],
    });
    expect(events).toHaveLength(0);
  });

  it("treats a midnight departure as date-only (time is null)", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [
        member({
          travel_mode: null,
          flight_arrival_time: null,
          departure_mode: "driving",
          departure_time: "2026-09-13T00:00:00Z",
        }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("departure");
    expect(events[0].date).toBe("2026-09-13");
    expect(events[0].time).toBeNull();
  });

  it("does not regress arrivals when no departure is set", () => {
    // A member with only an arrival still weaves in exactly one arrival event.
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [],
      members: [member()],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("arrival");
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
      logisticsItems: [lodgingItem({ check_in_date: null })],
      members: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("lodging-checkout");
  });

  it("skips check-out event when check_out_time is missing", () => {
    const events = buildItinerary({
      scheduleItems: [],
      logisticsItems: [lodgingItem({ check_out_date: null })],
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
          check_in_date: "2026-06-15",
          check_out_date: "2026-06-15",
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

  it("orders schedule items by sort_order, never by time (time is display-only)", () => {
    const events = buildItinerary({
      scheduleItems: [
        // s_early has the EARLIER time but a LATER sort_order — it must still
        // render after s_late, because Agenda's drag order (sort_order) wins.
        scheduleItem({ id: "s_early", scheduled_time: "09:00", sort_order: 5 }),
        scheduleItem({ id: "s_late", scheduled_time: "18:00", sort_order: 1 }),
      ],
      logisticsItems: [],
      members: [],
    });
    expect(events.map((e) => e.id)).toEqual(["s_late", "s_early"]);
  });

  it("keeps an untimed schedule item in its sort_order slot (not pushed to the end)", () => {
    const events = buildItinerary({
      scheduleItems: [
        scheduleItem({ id: "s_timed", scheduled_time: "09:00", sort_order: 1 }),
        scheduleItem({ id: "s_anytime", scheduled_time: null, sort_order: 0 }),
      ],
      logisticsItems: [],
      members: [],
    });
    // s_anytime has the lower sort_order, so it renders FIRST even though it
    // has no time — untimed agenda items sit in their drag slot, not the end.
    expect(events.map((e) => e.id)).toEqual(["s_anytime", "s_timed"]);
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

// ── summarizeLodging (top block) ──────────────────────────────────────────

describe("summarizeLodging", () => {
  // Column semantics (see LodgingPanel): `label` = property NAME,
  // name comes from `title`, capacity from `sleeps`.
  it("maps name from title and sleeps from the sleeps column, with computed nights", () => {
    const stays = summarizeLodging([
      lodgingItem({
        id: "l1",
        title: "Beach House",
        sleeps: "8", // sleeps count, NOT the name
        address: "1 Ocean Dr",
        check_in_date: "2026-06-17",
        check_out_date: "2026-06-19",
      }),
    ]);
    expect(stays).toEqual([
      {
        id: "l1",
        name: "Beach House",
        sleeps: "8",
        address: "1 Ocean Dr",
        checkIn: "2026-06-17",
        checkOut: "2026-06-19",
        nights: 2,
      },
    ]);
  });

  it("orders multiple properties by check-in date (handles mid-trip moves)", () => {
    const stays = summarizeLodging([
      lodgingItem({ id: "cabin", title: "Lake Cabin", check_in_date: "2026-06-19", check_out_date: "2026-06-21" }),
      lodgingItem({ id: "beach", title: "Beach House", check_in_date: "2026-06-17", check_out_date: "2026-06-19" }),
    ]);
    expect(stays.map((s) => s.id)).toEqual(["beach", "cabin"]);
  });

  it("returns null nights when there's no check-out date", () => {
    const stays = summarizeLodging([
      lodgingItem({ id: "l1", title: "Beach House", check_out_date: null }),
    ]);
    expect(stays[0].checkOut).toBeNull();
    expect(stays[0].nights).toBeNull();
  });

  it("sleeps is null when the sleeps column is empty/unset", () => {
    const stays = summarizeLodging([
      lodgingItem({ id: "l1", title: "Beach House", sleeps: null }),
    ]);
    expect(stays[0].sleeps).toBeNull();
  });

  it("skips non-lodging, unconfirmed, and check-in-less items", () => {
    const stays = summarizeLodging([
      lodgingItem({ id: "ok", title: "Keep" }),
      lodgingItem({ id: "unconf", is_confirmed: false }),
      lodgingItem({ id: "nodate", check_in_date: null }),
      lodgingItem({ id: "transport", type: "transport" }),
    ]);
    expect(stays.map((s) => s.id)).toEqual(["ok"]);
  });

  it("falls back name to 'Lodging' when title is empty (never uses sleeps as the name)", () => {
    const [a, b] = summarizeLodging([
      lodgingItem({ id: "a", title: "Named", sleeps: "6" }),
      lodgingItem({ id: "b", title: "", sleeps: "6" }),
    ]);
    expect(a.name).toBe("Named");
    expect(b.name).toBe("Lodging"); // NOT "6"
    expect(b.sleeps).toBe("6");
  });
});

// ── groupDayBlocks (past collapse + empty-run compression) ────────────────

describe("groupDayBlocks", () => {
  const T = "2026-06-17"; // today

  it("collapses all days before today into one past block at the front", () => {
    const blocks = groupDayBlocks(
      [
        { date: "2026-06-15", empty: false },
        { date: "2026-06-16", empty: true },
        { date: "2026-06-17", empty: false },
      ],
      T
    );
    expect(blocks[0]).toEqual({ type: "past", dates: ["2026-06-15", "2026-06-16"] });
    expect(blocks[1]).toEqual({ type: "day", date: "2026-06-17" });
  });

  it("compresses 2+ consecutive empty days into one run", () => {
    const blocks = groupDayBlocks(
      [
        { date: "2026-06-17", empty: false },
        { date: "2026-06-18", empty: true },
        { date: "2026-06-19", empty: true },
        { date: "2026-06-20", empty: false },
      ],
      T
    );
    expect(blocks).toEqual([
      { type: "day", date: "2026-06-17" },
      { type: "emptyRun", dates: ["2026-06-18", "2026-06-19"] },
      { type: "day", date: "2026-06-20" },
    ]);
  });

  it("keeps a lone empty day as its own (length-1) run", () => {
    const blocks = groupDayBlocks(
      [
        { date: "2026-06-17", empty: false },
        { date: "2026-06-18", empty: true },
        { date: "2026-06-19", empty: false },
      ],
      T
    );
    expect(blocks[1]).toEqual({ type: "emptyRun", dates: ["2026-06-18"] });
  });

  it("never folds today into an empty run, even when today is empty", () => {
    const blocks = groupDayBlocks(
      [
        { date: "2026-06-17", empty: true }, // today, empty
        { date: "2026-06-18", empty: true },
      ],
      T
    );
    expect(blocks[0]).toEqual({ type: "day", date: "2026-06-17" });
    expect(blocks[1]).toEqual({ type: "emptyRun", dates: ["2026-06-18"] });
  });
});
