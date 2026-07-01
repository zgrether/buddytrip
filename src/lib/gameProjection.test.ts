import { describe, it, expect } from "vitest";
import { rollupMatchPlay, type ProjMatch } from "./gameProjection";

// #533 — the match-play projection rule: up → leader's full points, all-square
// (started) → halved, not-started → nothing. Summed per team, N-team-aware.

const m = (aTeamId: string | null, bTeamId: string | null, leader: "A" | "B" | null, started: boolean): ProjMatch => ({
  aTeamId,
  bTeamId,
  leader,
  started,
});

describe("rollupMatchPlay", () => {
  it("an UP match gives the leader's team the full match points", () => {
    expect(rollupMatchPlay([m("blue", "red", "A", true)], 2)).toEqual({ blue: 2 });
    expect(rollupMatchPlay([m("blue", "red", "B", true)], 2)).toEqual({ red: 2 });
  });

  it("an ALL-SQUARE (started) match halves the points between the two teams", () => {
    expect(rollupMatchPlay([m("blue", "red", null, true)], 2)).toEqual({ blue: 1, red: 1 });
  });

  it("a NOT-STARTED match contributes nothing", () => {
    expect(rollupMatchPlay([m("blue", "red", null, false)], 2)).toEqual({});
    // even if a leader is somehow set, unstarted contributes nothing
    expect(rollupMatchPlay([m("blue", "red", "A", false)], 2)).toEqual({});
  });

  it("sums across a game's matches (the 'if it ended now' total)", () => {
    const matches = [
      m("blue", "red", "A", true), // blue +2
      m("blue", "red", "A", true), // blue +2
      m("blue", "red", "B", true), // red +2
      m("blue", "red", null, true), // halved: blue +1, red +1
      m("blue", "red", null, false), // not started: 0
    ];
    expect(rollupMatchPlay(matches, 2)).toEqual({ blue: 5, red: 3 });
  });

  it("is N-team-aware — a points cup with matches across >2 teams", () => {
    const matches = [
      m("a", "b", "A", true), // a +3
      m("c", "d", "B", true), // d +3
      m("a", "c", null, true), // halved: a +1.5, c +1.5
    ];
    expect(rollupMatchPlay(matches, 3)).toEqual({ a: 4.5, c: 1.5, d: 3 });
  });

  it("ignores an unattributed side (null team) but still credits the other", () => {
    expect(rollupMatchPlay([m("blue", null, "A", true)], 2)).toEqual({ blue: 2 });
    expect(rollupMatchPlay([m("blue", null, null, true)], 2)).toEqual({ blue: 1 }); // halve: only blue credited
  });
});
