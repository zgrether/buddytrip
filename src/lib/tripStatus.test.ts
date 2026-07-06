import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getEffectiveStatus, countdownLabel } from "./tripStatus";

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
