import { describe, it, expect } from "vitest";
import { strokeHoles, netForHole, buildDecided, matchState, type HoleResult } from "./matchPlay";

describe("strokeHoles", () => {
  it("returns nothing for n <= 0", () => {
    expect(strokeHoles(0).size).toBe(0);
    expect(strokeHoles(-2).size).toBe(0);
  });

  it("fallback (no index): strokes go on holes 1..n in order", () => {
    expect([...strokeHoles(3)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("fallback caps at 18", () => {
    expect(strokeHoles(18).size).toBe(18);
  });

  it("with a stroke index: the n hardest holes (index <= n) get a stroke", () => {
    // hole:        1  2  3  4 ... where the value is its difficulty rank (1 = hardest)
    const index = [10, 2, 18, 4, 14, 6, 16, 8, 12, 1, 11, 3, 17, 5, 15, 7, 13, 9];
    // n=3 → holes whose rank is 1,2,3 → hole 10 (1), hole 2 (2), hole 12 (3)
    expect([...strokeHoles(3, index)].sort((a, b) => a - b)).toEqual([2, 10, 12]);
  });

  it("a 9-hole index is honored — not rejected as 'not 18' and fed board-order", () => {
    // The real 9-hole course index [2,3,1,9,5,4,6,7,8]. n=6 → the 6 hardest by
    // index (rank ≤ 6) = holes 1(2), 2(3), 3(1), 5(5), 6(4), 7(6) → {1,2,3,5,6,7}.
    // The pre-fix `length === 18` gate fell back to board-order {1,2,3,4,5,6}.
    const index = [2, 3, 1, 9, 5, 4, 6, 7, 8];
    expect([...strokeHoles(6, index)].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it("no-index fallback respects a passed holeCount (won't strike beyond the round)", () => {
    // 12 strokes on a 9-hole round with no index → every hole, capped at 9.
    expect([...strokeHoles(12, undefined, 9)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("netForHole", () => {
  it("subtracts a stroke only on a hole the player receives one (fallback)", () => {
    expect(netForHole(5, 1, 1)).toBe(4); // hole 1 gets the stroke
    expect(netForHole(5, 2, 1)).toBe(5); // hole 2 does not
  });
});

describe("buildDecided", () => {
  it("emits a result only when BOTH grosses exist, in hole order", () => {
    const decided = buildDecided(
      { "1": 4, "2": 5, "3": 4 },
      { "1": 5, "2": 5 /* hole 3 missing */ },
      0,
      0
    );
    expect(decided).toEqual(["W", "H"]); // hole 1 A wins, hole 2 halved, hole 3 undecided
  });

  it("compares on NET — a received stroke can flip the hole", () => {
    // A gross 5, B gross 4 on hole 1; A receives 1 stroke (fallback → hole 1) → net 4 vs 4 → halve
    expect(buildDecided({ "1": 5 }, { "1": 4 }, 1, 0)).toEqual(["H"]);
    // without the stroke, B wins
    expect(buildDecided({ "1": 5 }, { "1": 4 }, 0, 0)).toEqual(["L"]);
  });
});

describe("matchState — in progress", () => {
  it("all square", () => {
    const s = matchState(["W", "L", "H"]);
    expect(s).toMatchObject({ up: 0, leader: null, over: false, margin: null });
  });

  it("one side up", () => {
    const s = matchState(["W", "H", "W", "L"]); // diff +1
    expect(s).toMatchObject({ up: 1, leader: "A", over: false, dormie: false, margin: null });
  });

  it("dormie — up by exactly the holes remaining (3 up / 3 to play)", () => {
    // 15 decided holes, A +3 → holesLeft 3, up 3 → dormie, not over
    const decided: HoleResult[] = [
      "W", "W", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H",
    ];
    const s = matchState(decided);
    expect(s).toMatchObject({ thru: 15, up: 3, holesLeft: 3, dormie: true, over: false, closed: false });
  });
});

describe("matchState — decided", () => {
  it("closed early → {up}&{holesLeft} (3&2)", () => {
    // A reaches +3 at hole 16 → holesLeft 2, up 3 > 2 → close as 3&2
    const decided: HoleResult[] = [
      "W", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "W",
    ];
    const s = matchState(decided);
    expect(s).toMatchObject({ closed: true, over: true, margin: "3&2", thru: 16, leader: "A" });
  });

  it("FREEZES at close-out — losing holes appended after 3&2 do not change it", () => {
    const closed3and2: HoleResult[] = [
      "W", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "W",
    ];
    const withPlayItOut = [...closed3and2, "L", "L"] as HoleResult[]; // holes 17, 18 played out
    expect(matchState(withPlayItOut).margin).toBe("3&2");
    expect(matchState(withPlayItOut).thru).toBe(16);
  });

  it("won through 18 → {up} UP", () => {
    // 18 decided, A +2, never decided early
    const decided: HoleResult[] = [
      "W", "L", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "W",
    ];
    const s = matchState(decided);
    expect(s).toMatchObject({ over: true, closed: false, margin: "2 UP", thru: 18 });
  });

  it("halved through 18 → AS", () => {
    const decided: HoleResult[] = [
      "W", "L", "W", "L", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H",
    ];
    const s = matchState(decided);
    expect(s).toMatchObject({ over: true, closed: false, margin: "AS", up: 0 });
  });
});

// 9-hole games: every case here computes WRONG under the old hardcoded-18
// matchState (close-out never fires, a finished match never goes `over`). The
// hole count comes from the round's scorecard schema, threaded by the caller.
describe("matchState — 9-hole rounds", () => {
  it("closed early 3&2 — A +3 at hole 7 of 9 → holesLeft 2 (would stay open under 18)", () => {
    // 7 decided holes, A reaches +3 on the 7th → holesLeft 9-7=2, up 3 > 2 → closed
    const decided: HoleResult[] = ["W", "W", "H", "H", "H", "H", "W"];
    const s = matchState(decided, 9);
    expect(s).toMatchObject({ closed: true, over: true, margin: "3&2", thru: 7, leader: "A" });
    // Regression guard: the same holes under 18 are NOT closed (the bug).
    expect(matchState(decided, 18)).toMatchObject({ closed: false, over: false });
  });

  it("halved through 9 → AS, and over=true (the bug: never finalized under 18)", () => {
    const decided: HoleResult[] = ["W", "L", "H", "H", "H", "H", "H", "H", "H"];
    const s = matchState(decided, 9);
    expect(s).toMatchObject({ over: true, closed: false, margin: "AS", up: 0, holesLeft: 0, thru: 9 });
    expect(matchState(decided, 18).over).toBe(false); // would never finalize under 18
  });

  it("won through 9 → 2 UP", () => {
    const decided: HoleResult[] = ["W", "L", "W", "H", "H", "H", "H", "H", "W"];
    const s = matchState(decided, 9);
    expect(s).toMatchObject({ over: true, closed: false, margin: "2 UP", thru: 9 });
  });

  it("dormie on 9 — A +2 at hole 7 → holesLeft 2, up 2 → dormie, not over", () => {
    const decided: HoleResult[] = ["W", "W", "H", "H", "H", "H", "H"];
    const s = matchState(decided, 9);
    expect(s).toMatchObject({ thru: 7, up: 2, holesLeft: 2, dormie: true, over: false, closed: false });
  });
});
