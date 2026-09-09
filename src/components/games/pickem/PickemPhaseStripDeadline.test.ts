import { describe, it, expect } from "vitest";
import { splitDeadline, joinDeadline } from "./PickemPhaseStrip";
import { parseTime, toTime24 } from "@/lib/time";

/**
 * The deadline editor's OWN conversion — the live one.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 *
 * `PickemDeadlineRow` exports a tested pair that does the same job
 * (`toLocalInputValue` / `fromLocalInputValue`), and it is easy to read that
 * coverage as covering this. It does not: those two have no caller left, since
 * the editor moved to the shared DatePicker/TimePicker pair, and these are what
 * the runner's Set button actually runs. A tested dead twin beside an untested
 * live one is CLAUDE.md #24's shape — the divergence hides in whichever copy
 * nobody is looking at.
 *
 * ── What a failure here looks like in the app ──────────────────────────────
 *
 * Silent. The runner picks 8:10 PM, the RPC stores an instant an offset away,
 * and the strip reads it back through the same skew so the round trip LOOKS
 * right on that device. It is wrong for everyone else and wrong against the
 * slate's kickoff strings, and nothing errors.
 */

describe("the deadline editor's round trip", () => {
  it("splits an instant into the TRIP zone's day and time", () => {
    // The incident's deadline: Wednesday 8:10 PM Eastern. On a UTC runner a
    // device-local build gives Sep 10 / 00:10 — a different DAY in the date
    // picker, not merely a different hour.
    const { date, time } = splitDeadline("2026-09-10T00:10:00.000Z");
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth() + 1).toBe(9);
    expect(date!.getDate()).toBe(9);
    expect(toTime24(time!)).toBe("20:10");
  });

  it("joins the picked wall clock back to the instant the runner MEANT", () => {
    // `setHours` here would read the picked time as the DEVICE's, so a runner
    // in Central typing 8:10 would store 9:10 Eastern — and then see it read
    // back as 9:10 beside an 8:20 kickoff.
    const iso = joinDeadline(new Date(2026, 8, 9, 12, 0), parseTime("20:10"));
    expect(iso).toBe("2026-09-10T00:10:00.000Z");
  });

  it("ROUND-TRIPS across the DST change, which is where an offset assumption breaks", () => {
    // DST ends 2am Sunday Nov 1 2026. Both of these read 8:10 PM to a person,
    // so both must survive the trip — at different UTC offsets (-4 then -5).
    for (const iso of [
      "2026-11-01T00:10:00.000Z", // Sat Oct 31, 8:10 PM EDT
      "2026-11-02T01:10:00.000Z", // Sun Nov 1, 8:10 PM EST
      "2026-09-10T00:10:00.000Z",
    ]) {
      const { date, time } = splitDeadline(iso);
      expect(joinDeadline(date, time)).toBe(iso);
    }
  });

  it("refuses a half-set deadline rather than inventing the missing half", () => {
    // A date with no time is not a deadline, and defaulting it would schedule a
    // close at an hour nobody picked.
    expect(joinDeadline(null, parseTime("20:10"))).toBeNull();
    expect(joinDeadline(new Date(2026, 8, 9, 12, 0), null)).toBeNull();
    expect(splitDeadline(null)).toEqual({ date: null, time: null });
    expect(splitDeadline("not-a-date")).toEqual({ date: null, time: null });
  });

  it("carries a NOON anchor on the date half, so no offset can roll the day", () => {
    // The picker reads only y/m/d off this Date. Building it at midnight would
    // put it one tick from the boundary, where any local-vs-trip offset lands
    // on the previous day — the classic off-by-one this repo has hit before
    // (`src/lib/dates.ts` exists because of it).
    const { date } = splitDeadline("2026-09-10T00:10:00.000Z");
    expect(date!.getHours()).toBe(12);
  });
});
