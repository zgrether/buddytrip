import { describe, it, expect } from "vitest";
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
    // Instants chosen either side of the DST change, since the round trip is
    // where a two-pass offset solve earns its keep.
    for (const iso of ["2026-11-08T16:00:00.000Z", "2026-09-10T00:10:00.000Z"]) {
      expect(fromLocalInputValue(toLocalInputValue(iso))).toBe(iso);
    }
  });

  it("renders the TRIP zone's hour — not UTC, and not the device's", () => {
    // 16:30Z on 2026-11-08 is 11:30 AM in Eastern (EST by November). The old
    // version read the DEVICE's clock, which gives 16:30 on a UTC runner and a
    // different answer again in Central — so a runner setting a deadline from
    // home saw it read back shifted. `toISOString()` would get it wrong too.
    expect(toLocalInputValue("2026-11-08T16:30:00.000Z")).toBe("2026-11-08T11:30");
  });

  it("honours an EXPLICIT zone, which is what makes the case above decisive", () => {
    // The assertion above still passes on a device-local build if the machine
    // happens to be set to Eastern. This one cannot: a build that reads the
    // device's clock ignores this argument entirely, so it fails on any runner
    // in any zone.
    expect(toLocalInputValue("2026-11-08T16:30:00.000Z", "Asia/Tokyo")).toBe("2026-11-09T01:30");
    expect(fromLocalInputValue("2026-11-09T01:30", "Asia/Tokyo")).toBe("2026-11-08T16:30:00.000Z");
  });

  it("sets the instant the runner MEANT — the deadline from the incident", () => {
    // Wednesday 8:10 PM Eastern, ten minutes before an 8:20 kickoff. Read from
    // Central it had said "closes 7:10 PM" beside an unmoved "8:20p".
    expect(fromLocalInputValue("2026-09-09T20:10")).toBe("2026-09-10T00:10:00.000Z");
    expect(formatDeadline("2026-09-10T00:10:00.000Z")).toBe("Wed, Sep 9, 8:10 PM ET");
  });

  it("LABELS the zone, because the kickoffs beside it cannot follow the reader", () => {
    // The label is the whole point of the change: a reader in another zone has
    // to be able to tell that neither clock on the screen is theirs.
    //
    // ONE spelling on both sides of the DST change — "ET" names the zone, not
    // its current offset. A derived EDT/EST label put two names for one zone on
    // a single screen once already.
    expect(formatDeadline("2026-09-10T00:10:00.000Z")).toContain(" ET");
    expect(formatDeadline("2026-11-08T16:30:00.000Z")).toContain(" ET");
    for (const iso of ["2026-09-10T00:10:00.000Z", "2026-11-08T16:30:00.000Z"]) {
      expect(formatDeadline(iso)).not.toMatch(/EDT|EST/);
    }
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
