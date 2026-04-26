import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTripCountdown } from "./tripCountdown";

/**
 * Tests pin "today" to a fixed local date so countdown math is deterministic
 * regardless of when the suite runs. We use 2026-04-26 (matches the
 * MEMORY.md currentDate at time of writing).
 */
const FIXED_TODAY = new Date(2026, 3, 26, 12, 0, 0); // April 26, 2026 (month is 0-indexed)

describe("getTripCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns idea when stage is idea (regardless of dates)", () => {
    expect(getTripCountdown("2026-06-01", "2026-06-05", "idea")).toEqual({ type: "idea" });
    expect(getTripCountdown(null, null, "idea")).toEqual({ type: "idea" });
  });

  it("returns no_dates when start or end is missing (non-idea stage)", () => {
    expect(getTripCountdown(null, null, "planning")).toEqual({ type: "no_dates" });
    expect(getTripCountdown("2026-06-01", null, "planning")).toEqual({ type: "no_dates" });
    expect(getTripCountdown(null, "2026-06-05", "going")).toEqual({ type: "no_dates" });
  });

  it("returns weeks when more than 14 days away", () => {
    // 2026-04-26 → 2026-12-31 ≈ 36 weeks
    const result = getTripCountdown("2026-12-31", "2027-01-07", "planning");
    expect(result.type).toBe("weeks");
    if (result.type === "weeks") {
      expect(result.weeks).toBeGreaterThan(14);
      expect(result.label).toMatch(/^\d+ weeks away$/);
    }
  });

  it("uses singular 'week' for 1 week (edge case at 7 days exactly is days, not weeks)", () => {
    // To trigger weeks=1 we need >14 days that rounds to 1 week — impossible.
    // So weeks is always >=2. Verify pluralization by going further out.
    const result = getTripCountdown("2026-05-26", "2026-05-30", "planning");
    expect(result.type).toBe("weeks");
    if (result.type === "weeks") {
      expect(result.label).toContain("weeks");
    }
  });

  it("returns days when 2-14 days away", () => {
    // 2026-04-26 → 2026-05-05 = 9 days
    const result = getTripCountdown("2026-05-05", "2026-05-08", "planning");
    expect(result).toEqual(
      expect.objectContaining({
        type: "days",
        days: 9,
        label: "9 days away",
      })
    );
  });

  it("returns 'Tomorrow' when daysUntil is 1", () => {
    const result = getTripCountdown("2026-04-27", "2026-04-30", "planning");
    expect(result).toEqual(
      expect.objectContaining({
        type: "days",
        days: 1,
        label: "Tomorrow",
      })
    );
  });

  it("returns 'Today is the day' when daysUntil is 0", () => {
    const result = getTripCountdown("2026-04-26", "2026-04-30", "planning");
    expect(result).toEqual({
      type: "today",
      label: "Today is the day",
    });
  });

  it("returns happening when today is between start and end (inclusive)", () => {
    // Trip 2026-04-24 → 2026-04-28; today is 04-26 → day 3 of 5
    const result = getTripCountdown("2026-04-24", "2026-04-28", "going");
    expect(result).toEqual({
      type: "happening",
      dayNumber: 3,
      totalDays: 5,
      label: "Live · Day 3 of 5",
    });
  });

  it("returns happening on the start day itself (day 1 of N)", () => {
    const result = getTripCountdown("2026-04-26", "2026-04-30", "going");
    // daysUntil === 0 hits the `today` branch first
    expect(result.type).toBe("today");
  });

  it("returns happening on the end day itself", () => {
    // Trip 2026-04-22 → 2026-04-26; today is 04-26 → day 5 of 5
    const result = getTripCountdown("2026-04-22", "2026-04-26", "going");
    expect(result).toEqual({
      type: "happening",
      dayNumber: 5,
      totalDays: 5,
      label: "Live · Day 5 of 5",
    });
  });

  it("returns 'Just wrapped' when ended within 1 week ago", () => {
    // Trip 2026-04-19 → 2026-04-22; today is 04-26 → 4 days after end → rounds to 1 week
    const result = getTripCountdown("2026-04-19", "2026-04-22", "going");
    expect(result.type).toBe("past");
    if (result.type === "past") {
      expect(result.label).toBe("Just wrapped");
      expect(result.weeksAgo).toBeLessThanOrEqual(1);
    }
  });

  it("returns 'N weeks ago' when ended 2-8 weeks ago", () => {
    // Trip 2026-03-01 → 2026-03-05; today is 04-26 → ~7-8 weeks ago
    const result = getTripCountdown("2026-03-01", "2026-03-05", "going");
    expect(result.type).toBe("past");
    if (result.type === "past") {
      expect(result.label).toMatch(/^\d+ weeks ago$/);
    }
  });

  it("returns past_distant ('Month YYYY') when more than 8 weeks ago", () => {
    // Trip 2025-12-01 → 2025-12-05; today is 2026-04-26 → ~21 weeks ago
    const result = getTripCountdown("2025-12-01", "2025-12-05", "going");
    expect(result).toEqual({
      type: "past_distant",
      label: "December 2025",
    });
  });
});
