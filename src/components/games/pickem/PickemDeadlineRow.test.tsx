import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  toLocalInputValue,
  fromLocalInputValue,
  formatDeadline,
} from "./PickemDeadlineRow";

/**
 * The deadline — the only pressure the game has, since reminders need a
 * scheduler and are deferred.
 *
 * The conversion helpers get the closest attention, because a timezone slip
 * here is silent: the runner sets 11:00, the input reads back 06:00, and
 * nothing errors.
 */

describe("local ↔ instant conversion", () => {
  it("ROUND-TRIPS an instant through the input's local wall clock", () => {
    // The property that matters: set a time, reload, see the same time. A
    // `toISOString()` slice would pass a naive equality test while displaying
    // the UTC hour, so this asserts the round trip rather than the format.
    const iso = new Date(2026, 10, 8, 11, 0).toISOString();
    expect(fromLocalInputValue(toLocalInputValue(iso))).toBe(iso);
  });

  it("renders the LOCAL hour, not the UTC one", () => {
    // Constructed in local time, so the input value must show that same hour
    // whatever zone the machine is in — which is exactly what `toISOString()`
    // would get wrong.
    const local = new Date(2026, 10, 8, 11, 30);
    expect(toLocalInputValue(local.toISOString())).toContain("T11:30");
  });

  it("treats an empty input as no deadline, not as an invalid date", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(toLocalInputValue(null)).toBe("");
  });

  it("refuses to invent a date from garbage", () => {
    // `new Date("nonsense")` is Invalid Date, whose toISOString() throws. A
    // deadline that throws on save is worse than one that does not set.
    expect(fromLocalInputValue("not-a-date")).toBeNull();
    expect(toLocalInputValue("not-a-date")).toBe("");
    expect(formatDeadline("not-a-date")).toBe("");
  });
});

/**
 * DELETED: describe("the row").
 *
 * Every case in it rendered `PickemDeadlineRow`, which is gone — a
 * settings-page row superseded by the block inside `PickemPhaseStrip` and
 * rendered nowhere since (#1128). Its copy was also the last runner-facing
 * "lock" in this surface, which is what brought it into the Start/Stop sweep.
 *
 * The conversion cases above stay, and they are the part that was ever
 * load-bearing: `toLocalInputValue` / `fromLocalInputValue` round-trip an
 * instant through a `datetime-local` field's wall clock, which is exactly
 * where a deadline silently moves by a timezone offset.
 */
