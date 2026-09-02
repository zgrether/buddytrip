import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  getEffectiveStatus,
  countdownLabel,
  isReadOnly,
  canReachTripSettings,
} from "./tripStatus";

/**
 * Pin "today" to a fixed LOCAL-noon instant so the countdown/status math is
 * deterministic regardless of when — or in which timezone — the suite runs.
 * Without this freeze these tests flake: `dayOffset` builds its fixtures from
 * the UTC calendar date (`toISOString`) while the code-under-test derives
 * "today" from the LOCAL calendar date (`new Date()` + `setHours(0,0,0,0)` and
 * `parseLocalDate`'s noon-local parsing). Late in the day in a western timezone
 * the two disagree by a day, flipping "Tomorrow" → "2 days to go" and crossing
 * the 3-day now/upcoming boundary. Freezing at local noon keeps the UTC and
 * local calendar dates aligned (mirrors tripCountdown.test.ts).
 */
const FIXED_TODAY = new Date(2026, 3, 26, 12, 0, 0); // April 26, 2026, local noon (month 0-indexed)

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper: ISO date string N days from the (frozen) today.
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

const LOCKED = new Date(2026, 3, 26, 12, 0, 0).toISOString();

describe("getEffectiveStatus", () => {
  it("returns 'idea' when no destination is locked", () => {
    expect(getEffectiveStatus({})).toBe("idea");
    expect(getEffectiveStatus({ locked_destination_at: null })).toBe("idea");
    // Even with dates set, a destination-less trip is still an idea.
    expect(
      getEffectiveStatus({ start_date: dayOffset(30), end_date: dayOffset(34) })
    ).toBe("idea");
  });

  it("returns 'past' when end_date + 3 days is in the past", () => {
    expect(
      getEffectiveStatus({
        locked_destination_at: LOCKED,
        end_date: dayOffset(-10),
      })
    ).toBe("past");
  });

  it("'past' wins even if the destination was never locked", () => {
    expect(getEffectiveStatus({ end_date: dayOffset(-10) })).toBe("past");
  });

  it("returns 'now' for a locked trip within 3 days of start", () => {
    expect(
      getEffectiveStatus({
        locked_destination_at: LOCKED,
        start_date: dayOffset(1),
        end_date: dayOffset(5),
      })
    ).toBe("now");
  });

  it("returns 'now' mid-trip (started, not yet 3 days past end)", () => {
    expect(
      getEffectiveStatus({
        locked_destination_at: LOCKED,
        start_date: dayOffset(-1),
        end_date: dayOffset(2),
      })
    ).toBe("now");
  });

  it("returns 'upcoming' for a locked trip with a distant start date", () => {
    expect(
      getEffectiveStatus({
        locked_destination_at: LOCKED,
        start_date: dayOffset(30),
        end_date: dayOffset(34),
      })
    ).toBe("upcoming");
  });

  it("returns 'upcoming' for a locked trip with no dates yet", () => {
    expect(getEffectiveStatus({ locked_destination_at: LOCKED })).toBe("upcoming");
  });
});

describe("countdownLabel", () => {
  it("returns null for non-now trips", () => {
    expect(countdownLabel({ locked_destination_at: LOCKED })).toBeNull();
  });

  it("returns null when trip has started", () => {
    expect(
      countdownLabel({
        locked_destination_at: LOCKED,
        start_date: dayOffset(-1),
        end_date: dayOffset(3),
      })
    ).toBeNull();
  });

  it("returns 'Tomorrow' for 1 day away", () => {
    expect(
      countdownLabel({
        locked_destination_at: LOCKED,
        start_date: dayOffset(1),
        end_date: dayOffset(5),
      })
    ).toBe("Tomorrow");
  });

  it("returns 'X days to go' for 2+ days", () => {
    expect(
      countdownLabel({
        locked_destination_at: LOCKED,
        start_date: dayOffset(2),
        end_date: dayOffset(7),
      })
    ).toBe("2 days to go");
  });
});

/**
 * The date lock must not be a ONE-WAY DOOR.
 *
 * `isReadOnly` is derived from `end_date`, and trip settings is where an owner
 * changes `end_date`. Gating the settings gear on `!isReadOnly` therefore froze
 * a trip permanently the first time it aged past the threshold: the banner said
 * "This trip is read-only" and removed the only control that could clear it.
 *
 * Reported as "a trip cannot be taken out of read-only for editing", which is
 * literally what the code did.
 */
describe("the read-only escape hatch", () => {
  /**
   * Comfortably past `nextSunday(end_date + 14)` — a genuinely locked trip.
   *
   * A FUNCTION, not a const. As a const it was evaluated at collection time,
   * before `beforeEach` installs the fake clock, so its "80 days ago" was
   * measured from the real today and then compared against a frozen April —
   * landing in the FUTURE and making the fixture not read-only at all. The
   * first case below caught it; every other case would have passed for a reason
   * unrelated to the lock. (The existing tests in this file call `dayOffset`
   * inside each `it` for the same reason.)
   */
  const lockedTrip = () => ({
    locked_destination_at: LOCKED,
    start_date: dayOffset(-90),
    end_date: dayOffset(-80),
  });

  it("the fixture is actually read-only (or the rest proves nothing)", () => {
    // Without this the cases below would pass on a trip that was never locked —
    // the assertion would hold for a reason that has nothing to do with the bug.
    expect(isReadOnly(lockedTrip())).toBe(true);
  });

  it("an OWNER still reaches settings on a read-only trip", () => {
    // The whole fix. Settings is where `trips.lockDates` lives, so this is the
    // only way back out of the lock.
    expect(canReachTripSettings(lockedTrip(), { isOwner: true })).toBe(true);
  });

  it("a NON-owner still does not — the lock did not widen who may edit", () => {
    expect(canReachTripSettings(lockedTrip(), { isOwner: false })).toBe(false);
  });

  it("read-only is never the reason settings is unreachable", () => {
    // Stated as the invariant rather than as two cases: for the same viewer, the
    // answer must not depend on the lock. A future edit that reintroduces
    // `&& !isReadOnly` fails here even if both cases above were rewritten.
    const OPEN_TRIP = {
      locked_destination_at: LOCKED,
      start_date: dayOffset(2),
      end_date: dayOffset(7),
    };
    expect(isReadOnly(OPEN_TRIP)).toBe(false);
    for (const isOwner of [true, false]) {
      expect(canReachTripSettings(lockedTrip(), { isOwner })).toBe(
        canReachTripSettings(OPEN_TRIP, { isOwner })
      );
    }
  });

  it("changing the dates forward clears the lock (the reported repro)", () => {
    // BBMI 2023: created with past dates, then moved to the future. Measured
    // against the real production row, the lock DOES clear — so a trip still
    // reading read-only after this is role gating, not the date lock.
    const before = lockedTrip();
    const after = { ...lockedTrip(), start_date: dayOffset(2), end_date: dayOffset(4) };
    expect(isReadOnly(before)).toBe(true);
    expect(isReadOnly(after)).toBe(false);
  });
});
