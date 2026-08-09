import { describe, it, expect } from "vitest";
import { quickGameSubtitle, type QuickGameState } from "./quickGame";

function state(overrides: Partial<QuickGameState>): QuickGameState {
  return {
    players: [
      { id: "p1", name: "Zach Grether", color: "#2dd4bf" },
      { id: "p2", name: "Buddy", color: "#60a5fa" },
    ],
    values: {},
    finished: false,
    currentHole: 1,
    ...overrides,
  };
}

describe("quickGameSubtitle", () => {
  it("no saved game → the always-available pitch line", () => {
    expect(quickGameSubtitle(null)).toBe("Keep score right now — no trip needed");
  });

  it("game exists, no scores yet → hole + no-scores, names nobody", () => {
    expect(quickGameSubtitle(state({ currentHole: 3 }))).toBe("Hole 3 of 18 · no scores yet");
  });

  it("in progress starts at creation, not at first score — a fresh game never names a leader", () => {
    // Players + a course, zero scores: must NOT read as "leading" or "tied".
    const s = state({ currentHole: 1, values: {} });
    expect(quickGameSubtitle(s)).not.toMatch(/leading|Tied/);
  });

  it("one player ahead → names them, to-par and thru", () => {
    // Par is [4,5,3,4,4,3,5,4,4, ...]; par 1 + par 2 = 9.
    const s = state({
      currentHole: 3,
      values: {
        p1: { "1": 4, "2": 4 }, // 8 strokes over par 9 → −1
        p2: { "1": 5, "2": 6 }, // 11 strokes over par 9 → +2
      },
    });
    expect(quickGameSubtitle(s)).toBe("Zach leading at −1 thru 2");
  });

  it("uses the player's first name only", () => {
    const s = state({
      values: {
        p1: { "1": 3 }, // par 4 → −1
        p2: { "1": 5 }, // par 4 → +1
      },
    });
    expect(quickGameSubtitle(s)).toMatch(/^Zach leading/);
  });

  it("tied leaders → no name", () => {
    const s = state({
      values: {
        p1: { "1": 4 },
        p2: { "1": 4 },
      },
    });
    expect(quickGameSubtitle(s)).toBe("Tied at E thru 1");
  });

  it("even par formats as E, not +0", () => {
    const s = state({ values: { p1: { "1": 4 } } });
    expect(quickGameSubtitle(s)).toBe("Zach leading at E thru 1");
  });

  it("agrees with the entry screen's own leader when only one player has scored", () => {
    // A late arrival (thru 0) must not appear "leading" by virtue of a 0 total —
    // computeStrokePlayStandings only ranks scoredIds, so p2 is excluded here.
    const s = state({ values: { p1: { "1": 6 } } }); // par 4 → +2
    expect(quickGameSubtitle(s)).toBe("Zach leading at +2 thru 1");
  });
});
