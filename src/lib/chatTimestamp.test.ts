import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  formatChatMessageTimestamp,
  formatChatDaySeparator,
  chatDayChanged,
} from "./chatTimestamp";

/**
 * Fixed `now`: Wednesday, 2026-08-26, 15:42 local. Every test computes its
 * message time relative to this so nothing depends on when the suite runs.
 */
const NOW = new Date(2026, 7, 26, 15, 42);
const at = (daysAgo: number, hour = 15, minute = 42) =>
  new Date(2026, 7, 26 - daysAgo, hour, minute).toISOString();

describe("formatChatMessageTimestamp — the reported bug, directly", () => {
  /**
   * THE ASSERTION THIS FILE EXISTS FOR. Two messages at literally the same
   * clock time on different days must produce different strings — the bug was
   * exactly that they didn't.
   */
  it("renders today and a week-old message at the identical clock time differently", () => {
    const today = formatChatMessageTimestamp(at(0, 3, 42), NOW);
    const lastWeek = formatChatMessageTimestamp(at(8, 3, 42), NOW);
    expect(today).not.toBe(lastWeek);
  });

  it("today is time-only", () => {
    expect(formatChatMessageTimestamp(at(0), NOW)).toBe("3:42 PM");
  });

  it("yesterday is named, not dated", () => {
    expect(formatChatMessageTimestamp(at(1), NOW)).toBe("Yesterday 3:42 PM");
  });

  it("this week uses the short weekday", () => {
    // 3 days ago from Wed 8/26 is Sun 8/23.
    expect(formatChatMessageTimestamp(at(3), NOW)).toBe("Sun 3:42 PM");
  });

  it("exactly a week ago is a date, not a weekday", () => {
    // The boundary: `diff < 7` is what decides this, so 7 exactly must fall
    // on the DATE side, not linger as a weekday one day too many.
    expect(formatChatMessageTimestamp(at(7), NOW)).toMatch(/^Aug 19/);
  });

  it("older than a week is a date", () => {
    expect(formatChatMessageTimestamp(at(30), NOW)).toBe("Jul 27 3:42 PM");
  });

  it("includes the year once a message crosses one", () => {
    const lastYear = new Date(2025, 11, 25, 15, 42).toISOString();
    expect(formatChatMessageTimestamp(lastYear, NOW)).toBe("Dec 25, 2025 3:42 PM");
  });

  /**
   * Clock skew: a device with a fast clock inserts a message a few seconds
   * "in the future" relative to a reader whose clock is accurate. This must
   * not produce a negative day count or a nonsense label — it reads as today.
   */
  it("treats a message slightly ahead of `now` as today, not as an error", () => {
    const future = new Date(NOW.getTime() + 5000).toISOString();
    expect(formatChatMessageTimestamp(future, NOW)).toMatch(/^\d{1,2}:\d{2}/);
  });
});

describe("formatChatDaySeparator — one label, shared with the stamp", () => {
  /**
   * Same word as the stamp prefix, always. If a separator and the stamp
   * beneath it ever disagreed ("Tuesday" over a bubble reading "Wed 3:42 PM"),
   * that would be worse than no day information at all — pinned by deriving
   * both from the same fixture set.
   */
  it.each([
    [0, "Today"],
    [1, "Yesterday"],
    [3, "Sun"],
    [30, "Jul 27"],
  ])("day %i ago separator matches the stamp's own prefix", (daysAgo, label) => {
    const iso = at(daysAgo);
    expect(formatChatDaySeparator(iso, NOW)).toBe(label);
    if (label === "Today") {
      expect(formatChatMessageTimestamp(iso, NOW)).not.toContain(label);
    } else {
      expect(formatChatMessageTimestamp(iso, NOW)).toContain(label);
    }
  });
});

describe("chatDayChanged — where a separator belongs in the transcript", () => {
  it("is true for the first message rendered (nothing above it)", () => {
    expect(chatDayChanged(at(0), null)).toBe(true);
  });

  it("is false for two messages the same local day, however far apart in time", () => {
    const morning = new Date(2026, 7, 26, 6, 0).toISOString();
    const night = new Date(2026, 7, 26, 23, 59).toISOString();
    expect(chatDayChanged(night, morning)).toBe(false);
  });

  it("is true the moment the calendar day rolls over, even one minute apart", () => {
    const beforeMidnight = new Date(2026, 7, 25, 23, 59).toISOString();
    const afterMidnight = new Date(2026, 7, 26, 0, 1).toISOString();
    expect(chatDayChanged(afterMidnight, beforeMidnight)).toBe(true);
  });

  /**
   * THIS IS RELATIVE TO THE PREVIOUS MESSAGE, NOT TO `now`. A five-day-old
   * transcript read today must still show its OWN internal day boundaries —
   * this function takes no `now` at all, which is what makes that structural
   * rather than a convention someone has to remember.
   */
  it("finds a boundary between two old messages with no `now` involved", () => {
    expect(chatDayChanged(at(2), at(3))).toBe(true);
    expect(chatDayChanged(at(2, 8, 0), at(2, 20, 0))).toBe(false);
  });
});

describe("a five-day transcript — the case that will actually happen on the trip", () => {
  /**
   * Not a unit assertion so much as a rehearsal: walk a multi-day transcript
   * exactly the way the render loop will, and confirm every adjacent pair
   * either shares a day (no separator, same-looking stamps where same day) or
   * gets a boundary — never silently ambiguous.
   */
  it("places a boundary at every day change across 5 days, and nowhere else", () => {
    const transcript = [at(4, 9), at(4, 20), at(3, 8), at(3, 9), at(1, 12), at(0, 8)];
    const boundaries = transcript.map((iso, i) =>
      chatDayChanged(iso, i === 0 ? null : transcript[i - 1])
    );
    expect(boundaries).toEqual([true, false, true, false, true, true]);
  });
});

describe("FloatingChatPanel actually wires this in", () => {
  /**
   * A SOURCE guard, same trade as `chatPanelActive.test.ts`: the panel is
   * tRPC-wired with no render-test infra in this suite, and the regression
   * this guards — reverting to `toLocaleTimeString` while leaving this file
   * green — would otherwise go unnoticed, since every assertion above is
   * about the pure functions, not about whether anything calls them.
   */
  it("calls the day-aware formatter for the per-message stamp, not toLocaleTimeString directly", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../components/FloatingChatPanel.tsx"),
      "utf8"
    );
    expect(src).toContain("formatChatMessageTimestamp(msg.created_at)");
    expect(src).toContain("chatDayChanged(");
    expect(src).toContain("formatChatDaySeparator(");
    expect(src).not.toMatch(/const time = new Date\(msg\.created_at\)\.toLocaleTimeString/);
  });
});
