import { describe, it, expect } from "vitest";
import {
  atNoon,
  isSameDay,
  isBeforeDay,
  isAfterDay,
  addDays,
  addMonths,
  nightsBetween,
  startOfMonth,
  monthMatrix,
  applyRangeClick,
  isWithinRange,
  isOutOfBounds,
  nextFriday,
  rangePresets,
  type DateRange,
} from "./calendar";

/** Helper: build a local-noon day from y/m/d (month is 1-based here for readability). */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0, 0, 0);

describe("atNoon", () => {
  it("strips time-of-day to local noon", () => {
    const result = atNoon(new Date(2026, 5, 15, 23, 45, 30, 500));
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getDate()).toBe(15);
  });

  it("preserves the calendar day for early-morning times", () => {
    const result = atNoon(new Date(2026, 5, 15, 0, 5, 0, 0));
    expect(result.getDate()).toBe(15);
  });
});

describe("isSameDay", () => {
  it("ignores time-of-day", () => {
    expect(isSameDay(new Date(2026, 5, 15, 1, 0), new Date(2026, 5, 15, 23, 0))).toBe(true);
  });
  it("distinguishes different days", () => {
    expect(isSameDay(d(2026, 6, 15), d(2026, 6, 16))).toBe(false);
  });
  it("returns false when either side is null", () => {
    expect(isSameDay(null, d(2026, 6, 15))).toBe(false);
    expect(isSameDay(d(2026, 6, 15), null)).toBe(false);
    expect(isSameDay(null, null)).toBe(false);
  });
});

describe("isBeforeDay / isAfterDay", () => {
  it("compares at day granularity", () => {
    expect(isBeforeDay(d(2026, 6, 14), d(2026, 6, 15))).toBe(true);
    expect(isAfterDay(d(2026, 6, 16), d(2026, 6, 15))).toBe(true);
  });
  it("same day is neither before nor after", () => {
    expect(isBeforeDay(d(2026, 6, 15), d(2026, 6, 15))).toBe(false);
    expect(isAfterDay(d(2026, 6, 15), d(2026, 6, 15))).toBe(false);
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    expect(isSameDay(addDays(d(2026, 6, 15), 3), d(2026, 6, 18))).toBe(true);
  });
  it("adds negative days across a month boundary", () => {
    expect(isSameDay(addDays(d(2026, 6, 1), -1), d(2026, 5, 31))).toBe(true);
  });
});

describe("addMonths", () => {
  it("advances by whole months", () => {
    expect(isSameDay(addMonths(d(2026, 1, 15), 2), d(2026, 3, 15))).toBe(true);
  });
  it("clamps the day to the target month's length", () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year)
    expect(isSameDay(addMonths(d(2026, 1, 31), 1), d(2026, 2, 28))).toBe(true);
  });
  it("handles negative months across a year boundary", () => {
    expect(isSameDay(addMonths(d(2026, 1, 15), -1), d(2025, 12, 15))).toBe(true);
  });
});

describe("nightsBetween", () => {
  it("counts whole nights", () => {
    expect(nightsBetween(d(2026, 6, 15), d(2026, 6, 18))).toBe(3);
  });
  it("is zero for the same day", () => {
    expect(nightsBetween(d(2026, 6, 15), d(2026, 6, 15))).toBe(0);
  });
  it("counts across a month boundary", () => {
    expect(nightsBetween(d(2026, 6, 28), d(2026, 7, 2))).toBe(4);
  });
});

describe("startOfMonth", () => {
  it("returns the first day at noon", () => {
    const result = startOfMonth(d(2026, 6, 15));
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(5);
    expect(result.getHours()).toBe(12);
  });
});

describe("monthMatrix", () => {
  it("returns a 6x7 grid", () => {
    const grid = monthMatrix(d(2026, 6, 15));
    expect(grid).toHaveLength(6);
    grid.forEach((week) => expect(week).toHaveLength(7));
  });
  it("starts each row on Sunday", () => {
    const grid = monthMatrix(d(2026, 6, 15));
    grid.forEach((week) => expect(week[0].getDay()).toBe(0));
  });
  it("includes leading days from the previous month", () => {
    // June 2026: the 1st is a Monday, so the grid starts on Sun May 31.
    const grid = monthMatrix(d(2026, 6, 15));
    expect(isSameDay(grid[0][0], d(2026, 5, 31))).toBe(true);
  });
  it("contains the first of the target month", () => {
    const grid = monthMatrix(d(2026, 6, 15));
    const flat = grid.flat();
    expect(flat.some((day) => isSameDay(day, d(2026, 6, 1)))).toBe(true);
  });
});

describe("applyRangeClick", () => {
  it("begins a new range when nothing is selected", () => {
    const result = applyRangeClick({ start: null, end: null }, d(2026, 6, 15));
    expect(isSameDay(result.start, d(2026, 6, 15))).toBe(true);
    expect(result.end).toBeNull();
  });

  it("sets the end when clicking a later day after a start", () => {
    const result = applyRangeClick({ start: d(2026, 6, 15), end: null }, d(2026, 6, 18));
    expect(isSameDay(result.start, d(2026, 6, 15))).toBe(true);
    expect(isSameDay(result.end, d(2026, 6, 18))).toBe(true);
  });

  it("allows end == start (same-day click)", () => {
    const result = applyRangeClick({ start: d(2026, 6, 15), end: null }, d(2026, 6, 15));
    expect(isSameDay(result.start, d(2026, 6, 15))).toBe(true);
    expect(isSameDay(result.end, d(2026, 6, 15))).toBe(true);
  });

  it("resets the start when clicking before the current start", () => {
    const result = applyRangeClick({ start: d(2026, 6, 15), end: null }, d(2026, 6, 10));
    expect(isSameDay(result.start, d(2026, 6, 10))).toBe(true);
    expect(result.end).toBeNull();
  });

  it("begins a fresh range when a complete range already exists", () => {
    const complete: DateRange = { start: d(2026, 6, 15), end: d(2026, 6, 18) };
    const result = applyRangeClick(complete, d(2026, 6, 20));
    expect(isSameDay(result.start, d(2026, 6, 20))).toBe(true);
    expect(result.end).toBeNull();
  });
});

describe("isWithinRange", () => {
  const range: DateRange = { start: d(2026, 6, 15), end: d(2026, 6, 18) };
  it("is true for an interior day", () => {
    expect(isWithinRange(d(2026, 6, 16), range)).toBe(true);
  });
  it("excludes the caps", () => {
    expect(isWithinRange(d(2026, 6, 15), range)).toBe(false);
    expect(isWithinRange(d(2026, 6, 18), range)).toBe(false);
  });
  it("is false for an incomplete range", () => {
    expect(isWithinRange(d(2026, 6, 16), { start: d(2026, 6, 15), end: null })).toBe(false);
  });
});

describe("isOutOfBounds", () => {
  const min = d(2026, 6, 10);
  const max = d(2026, 6, 20);
  it("flags days before min", () => {
    expect(isOutOfBounds(d(2026, 6, 9), min, max)).toBe(true);
  });
  it("flags days after max", () => {
    expect(isOutOfBounds(d(2026, 6, 21), min, max)).toBe(true);
  });
  it("allows the boundary days", () => {
    expect(isOutOfBounds(min, min, max)).toBe(false);
    expect(isOutOfBounds(max, min, max)).toBe(false);
  });
  it("is never out of bounds without limits", () => {
    expect(isOutOfBounds(d(2026, 6, 15))).toBe(false);
  });
});

describe("nextFriday", () => {
  it("returns the same day when already Friday", () => {
    // June 5, 2026 is a Friday.
    expect(isSameDay(nextFriday(d(2026, 6, 5)), d(2026, 6, 5))).toBe(true);
  });
  it("returns the upcoming Friday otherwise", () => {
    // June 1, 2026 is a Monday → next Friday is June 5.
    expect(isSameDay(nextFriday(d(2026, 6, 1)), d(2026, 6, 5))).toBe(true);
  });
});

describe("rangePresets", () => {
  // today = Monday June 1, 2026 → next Friday = June 5.
  const presets = rangePresets(d(2026, 6, 1));

  it("returns weekend, long-weekend and week presets", () => {
    expect(presets.map((p) => p.id)).toEqual(["weekend", "long-weekend", "week"]);
  });
  it("This weekend spans Fri → Sun", () => {
    const weekend = presets.find((p) => p.id === "weekend")!;
    expect(isSameDay(weekend.range.start, d(2026, 6, 5))).toBe(true);
    expect(isSameDay(weekend.range.end, d(2026, 6, 7))).toBe(true);
  });
  it("Long weekend spans Fri → Mon", () => {
    const long = presets.find((p) => p.id === "long-weekend")!;
    expect(isSameDay(long.range.start, d(2026, 6, 5))).toBe(true);
    expect(isSameDay(long.range.end, d(2026, 6, 8))).toBe(true);
  });
  it("A week spans Fri → following Fri", () => {
    const week = presets.find((p) => p.id === "week")!;
    expect(isSameDay(week.range.start, d(2026, 6, 5))).toBe(true);
    expect(isSameDay(week.range.end, d(2026, 6, 12))).toBe(true);
  });
});
