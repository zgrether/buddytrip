import { describe, it, expect } from "vitest";
import { groupSlateByDay, splitKickoffDay } from "./pickemSlateDays";

/**
 * The slate's day grouping.
 *
 * `kickoff` is free text a runner typed, so almost every case here is about
 * REFUSING to group rather than about grouping — a heading the reader cannot
 * check is worse than no heading.
 */

const g = (kickoff: string | null) => ({ kickoff });

describe("splitKickoffDay", () => {
  it("takes the day off the front and leaves the time", () => {
    // Hand-typed: a day and a time, no date.
    expect(splitKickoffDay("Thu 8:15p")).toEqual({
      day: "Thu",
      key: "thursday",
      date: null,
      time: "8:15p",
    });
    expect(splitKickoffDay("Sat. 12:00p")).toEqual({
      day: "Sat",
      key: "saturday",
      date: null,
      time: "12:00p",
    });

    // From the search: `formatKickoff` emits "Fri Aug 28, 8:00p", and the date
    // is what the day HEADING carries so the row does not repeat it.
    expect(splitKickoffDay("Fri Aug 28, 8:00p")).toEqual({
      day: "Fri",
      key: "friday|Aug 28",
      date: "Aug 28",
      time: "8:00p",
    });
  });

  it("keeps the runner's own spelling, and still knows which day it is", () => {
    // Rewriting "Thursday" to "Thu" would be this module having an opinion
    // about somebody else's labels — but the grouping still has to see that
    // "Thu" and "Thursday" are one day.
    expect(splitKickoffDay("Thursday 8:15p")?.day).toBe("Thursday");
    expect(splitKickoffDay("Thursday 8:15p")?.key).toBe("thursday");
    expect(splitKickoffDay("Thu 8:15p")?.key).toBe("thursday");
    // ...and with a date, the same day on the same date is still one key.
    expect(splitKickoffDay("Thursday Aug 27, 8:15p")?.key).toBe("thursday|Aug 27");
    expect(splitKickoffDay("Thu Aug 27, 8:15p")?.key).toBe("thursday|Aug 27");
  });

  it("says NO to anything that is not a day", () => {
    for (const k of [null, undefined, "", "   ", "12/25 1:00", "8:15p", "TBD", "Noon"]) {
      expect(splitKickoffDay(k), String(k)).toBeNull();
    }
  });

  it("does not mistake a word that merely BEGINS with a day", () => {
    /**
     * "monsoon".startsWith("mon") is true, so matching a day as a prefix of the
     * WORD reads this as Monday and files the game under a heading nobody
     * wrote. The check runs the other way — the word must be a prefix of the
     * DAY — which refuses this and still accepts the real abbreviations.
     *
     * This assertion replaces one that could not fail: it read
     * `splitKickoffDay("Monsoon…")?.day` and expected "Monsoon", which the
     * function returns either way, since it echoes the runner's spelling. The
     * comment claimed a refusal the assertion never checked — and the code did
     * have the bug the comment described.
     */
    expect(splitKickoffDay("Monsoon 3:00p")).toBeNull();
    expect(splitKickoffDay("Satellite 1:00p")).toBeNull();

    // ...while the abbreviations people actually type still resolve.
    expect(splitKickoffDay("Tues 7:00p")?.key).toBe("tuesday");
    expect(splitKickoffDay("Thur 8:15p")?.key).toBe("thursday");
    expect(splitKickoffDay("Sat 3:30p")?.key).toBe("saturday");
  });
});

describe("groupSlateByDay", () => {
  it("groups consecutive runs and counts each", () => {
    const groups = groupSlateByDay([
      g("Thu 8:15p"),
      g("Sat 12:00p"),
      g("Sat 3:30p"),
      g("Sun 1:00p"),
    ]);
    expect(groups?.map((x) => [x.day, x.games.length])).toEqual([
      ["Thu", 1],
      ["Sat", 2],
      ["Sun", 1],
    ]);
  });

  it("refuses the WHOLE grouping when one game has no day", () => {
    /**
     * The decisive case. Partial grouping would file the unplaceable game under
     * whichever heading happened to precede it, and the reader would have no
     * way to know it had been guessed at — a heading you cannot check is worse
     * than the flat list.
     *
     * The pair is the assertion: the same slate groups once the gap is filled.
     */
    const broken = [g("Thu 8:15p"), g("TBD"), g("Sun 1:00p")];
    expect(groupSlateByDay(broken)).toBeNull();

    const fixed = [g("Thu 8:15p"), g("Fri 7:00p"), g("Sun 1:00p")];
    expect(groupSlateByDay(fixed)).toHaveLength(3);
  });

  it("refuses when there is only ONE group to make", () => {
    // A single heading over the whole list distinguishes nothing, and the rows
    // would give up their full kickoff string for no gain.
    expect(groupSlateByDay([g("Sat 1:00p"), g("Sat 4:00p")])).toBeNull();
    expect(groupSlateByDay([g("Sat 1:00p")])).toBeNull();
  });

  it("refuses an empty slate rather than returning an empty grouping", () => {
    // Null means "render it flat", which is what an empty list wants — not a
    // zero-group structure the caller would have to special-case anyway.
    expect(groupSlateByDay([])).toBeNull();
  });

  it("does NOT reorder — a second Saturday stays where the runner put it", () => {
    /**
     * Bucketing by day would move the trailing Saturday up beside the first,
     * silently changing a list whose order is the runner's own and is what
     * every ranking on every sheet is built against.
     */
    const groups = groupSlateByDay([
      g("Sat 12:00p"),
      g("Sun 1:00p"),
      g("Saturday 8:00p"),
    ]);
    expect(groups?.map((x) => x.day)).toEqual(["Sat", "Sun", "Saturday"]);
    expect(groups?.map((x) => x.games.length)).toEqual([1, 1, 1]);
  });
});

describe("two different Saturdays are two days", () => {
  it("does not merge them onto one heading", () => {
    /**
     * Keyed on the weekday alone — which is what shipped first — a slate
     * spanning more than one week folds every Saturday into a single group,
     * and a pick'em slate spanning weeks is the ordinary case rather than an
     * edge one. The date is what tells them apart.
     */
    const groups = groupSlateByDay([
      { kickoff: "Sat Aug 29, 12:00p" },
      { kickoff: "Sat Sep 5, 3:30p" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups?.map((g) => g.date)).toEqual(["Aug 29", "Sep 5"]);
  });

  it("still groups the same Saturday together", () => {
    // The control: without it, a build that never grouped anything would pass
    // the case above.
    const groups = groupSlateByDay([
      { kickoff: "Sat Aug 29, 12:00p" },
      { kickoff: "Sat Aug 29, 3:30p" },
      { kickoff: "Sun Aug 30, 1:00p" },
    ]);
    expect(groups?.map((g) => [g.day, g.date, g.games.length])).toEqual([
      ["Sat", "Aug 29", 2],
      ["Sun", "Aug 30", 1],
    ]);
  });
});
