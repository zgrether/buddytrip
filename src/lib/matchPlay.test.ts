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
