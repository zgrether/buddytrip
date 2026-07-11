import { describe, it, expect } from "vitest";
import { strokeHoles, buildDecided, matchState, matchHasScores, type HoleResult, type DecidedHole } from "./matchPlay";
import { NO_GLORIOUS, type GloriousConfig } from "./gloriousHoles";

// Compact builder: a sequential run of outcomes on holes 1..n (no gaps) — the shape
// buildDecided emits for an in-order match. Glorious cases that need specific hole
// numbers build DecidedHole[] explicitly.
const seq = (rs: HoleResult[]): DecidedHole[] => rs.map((result, i) => ({ hole: i + 1, result }));
const GLOR3: GloriousConfig = { enabled: true, n: 3 }; // last 3 holes (16,17,18) worth 2×

// W-GAMEPAGE-01 §11 — the destructive-edit guard's "scores exist" signal.
describe("matchHasScores", () => {
  it("is false for a match with no decided holes (nothing to lose → no confirm)", () => {
    expect(matchHasScores([])).toBe(false);
  });
  it("is true once any hole is decided (scores entered → confirm before removal)", () => {
    expect(matchHasScores(seq(["W"]))).toBe(true);
    expect(matchHasScores(seq(["H", "L", "W"]))).toBe(true);
  });
});

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
    const index = [10, 2, 18, 4, 14, 6, 16, 8, 12, 1, 11, 3, 17, 5, 15, 7, 13, 9];
    expect([...strokeHoles(3, index)].sort((a, b) => a - b)).toEqual([2, 10, 12]);
  });

  it("a 9-hole index is honored — not rejected as 'not 18' and fed board-order", () => {
    const index = [2, 3, 1, 9, 5, 4, 6, 7, 8];
    expect([...strokeHoles(6, index)].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it("no-index fallback respects a passed holeCount (won't strike beyond the round)", () => {
    expect([...strokeHoles(12, undefined, 9)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("buildDecided — emits {hole, result}", () => {
  it("emits a result only when BOTH grosses exist, tagged with the hole number", () => {
    const decided = buildDecided(
      { "1": 4, "2": 5, "3": 4 },
      { "1": 5, "2": 5 /* hole 3 missing */ },
      0,
      0
    );
    // hole 1 A wins, hole 2 halved, hole 3 undecided (absent — NOT a positional gap)
    expect(decided).toEqual([{ hole: 1, result: "W" }, { hole: 2, result: "H" }]);
  });

  it("carries the true hole number across a gap (undecided hole simply absent)", () => {
    const decided = buildDecided({ "1": 4, "3": 4 }, { "1": 5, "3": 5 }, 0, 0);
    expect(decided).toEqual([{ hole: 1, result: "W" }, { hole: 3, result: "W" }]);
  });

  it("compares on NET — a received stroke can flip the hole", () => {
    expect(buildDecided({ "1": 5 }, { "1": 4 }, 1, 0)).toEqual([{ hole: 1, result: "H" }]);
    expect(buildDecided({ "1": 5 }, { "1": 4 }, 0, 0)).toEqual([{ hole: 1, result: "L" }]);
  });
});

describe("matchState — in progress (standard, no glorious)", () => {
  it("all square", () => {
    expect(matchState(seq(["W", "L", "H"]))).toMatchObject({ up: 0, leader: null, over: false, margin: null });
  });

  it("one side up", () => {
    expect(matchState(seq(["W", "H", "W", "L"]))).toMatchObject({ up: 1, leader: "A", over: false, dormie: false, margin: null });
  });

  it("dormie — up by exactly the holes remaining (3 up / 3 to play)", () => {
    const decided = seq(["W", "W", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H"]);
    expect(matchState(decided)).toMatchObject({ thru: 15, up: 3, holesLeft: 3, dormie: true, over: false, closed: false });
  });
});

describe("matchState — decided (standard, no glorious)", () => {
  it("closed early → {up}&{holesLeft} (3&2)", () => {
    const decided = seq(["W", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "W"]);
    expect(matchState(decided)).toMatchObject({ closed: true, over: true, margin: "3&2", thru: 16, leader: "A" });
  });

  it("FREEZES at close-out — losing holes appended after 3&2 do not change it", () => {
    const closed3and2 = seq(["W", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "W"]);
    const withPlayItOut: DecidedHole[] = [...closed3and2, { hole: 17, result: "L" }, { hole: 18, result: "L" }];
    expect(matchState(withPlayItOut).margin).toBe("3&2");
    expect(matchState(withPlayItOut).thru).toBe(16);
  });

  it("won through 18 → {up} UP", () => {
    const decided = seq(["W", "L", "W", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "W"]);
    expect(matchState(decided)).toMatchObject({ over: true, closed: false, margin: "2 UP", thru: 18 });
  });

  it("halved through 18 → AS", () => {
    const decided = seq(["W", "L", "W", "L", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H"]);
    expect(matchState(decided)).toMatchObject({ over: true, closed: false, margin: "AS", up: 0 });
  });
});

describe("matchState — 9-hole rounds", () => {
  it("closed early 3&2 — A +3 at hole 7 of 9 (would stay open under 18)", () => {
    const decided = seq(["W", "W", "H", "H", "H", "H", "W"]);
    expect(matchState(decided, 9)).toMatchObject({ closed: true, over: true, margin: "3&2", thru: 7, leader: "A" });
    expect(matchState(decided, 18)).toMatchObject({ closed: false, over: false });
  });

  it("halved through 9 → AS, over=true", () => {
    const decided = seq(["W", "L", "H", "H", "H", "H", "H", "H", "H"]);
    expect(matchState(decided, 9)).toMatchObject({ over: true, closed: false, margin: "AS", up: 0, holesLeft: 0, thru: 9 });
    expect(matchState(decided, 18).over).toBe(false);
  });

  it("won through 9 → 2 UP", () => {
    expect(matchState(seq(["W", "L", "W", "H", "H", "H", "H", "H", "W"]), 9)).toMatchObject({ over: true, margin: "2 UP", thru: 9 });
  });

  it("dormie on 9 — A +2 at hole 7 → holesLeft 2, up 2", () => {
    expect(matchState(seq(["W", "W", "H", "H", "H", "H", "H"]), 9)).toMatchObject({ thru: 7, up: 2, holesLeft: 2, dormie: true, over: false });
  });
});

// ── Glorious Finishing Holes — the acceptance gates (§6) ───────────────────────
//
// Scenarios: `downSix` = 6 down through hole 15 (6 losses on 1–6, halves 7–15).

const downSix: DecidedHole[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ hole: i + 1, result: "L" as HoleResult })), // holes 1–6 lost
  ...Array.from({ length: 9 }, (_, i) => ({ hole: i + 7, result: "H" as HoleResult })), // holes 7–15 halved
];
const upN = (n: number): DecidedHole[] => [
  ...Array.from({ length: n }, (_, i) => ({ hole: i + 1, result: "W" as HoleResult })),
  ...Array.from({ length: 15 - n }, (_, i) => ({ hole: n + i + 1, result: "H" as HoleResult })),
]; // A is `n` up through hole 15

describe("§6a — comeback squares: down 6 thru 15, win 16/17/18 → all square", () => {
  it("glorious N=3 ON: the three ±2 swings pull a 6-down match back to AS (emerges from the weighted sum)", () => {
    const comeback: DecidedHole[] = [...downSix, { hole: 16, result: "W" }, { hole: 17, result: "W" }, { hole: 18, result: "W" }];
    expect(matchState(comeback, 18, GLOR3)).toMatchObject({ over: true, up: 0, leader: null, margin: "AS" });
  });

  it("glorious OFF: the same player is eliminated — closed out at hole 13 (6 down, only 5 raw swing left)", () => {
    const comeback: DecidedHole[] = [...downSix, { hole: 16, result: "W" }, { hole: 17, result: "W" }, { hole: 18, result: "W" }];
    // Under raw rules the match is already dead at hole 13 (6 up > 5 holes left) —
    // frozen there, so the 16/17/18 comeback wins are never even counted.
    expect(matchState(comeback, 18, NO_GLORIOUS)).toMatchObject({ over: true, closed: true, thru: 13, leader: "B", margin: "6&5" });
  });
});

describe("§6b — close-out respects WEIGHTED swing (N=3, glorious ON)", () => {
  it("4 up thru 15 is NOT closed and NOT dormie (lead 4 ≤ remaining swing 6)", () => {
    expect(matchState(upN(4), 18, GLOR3)).toMatchObject({ up: 4, over: false, closed: false, dormie: false, margin: null });
  });
  it("6 up thru 15 IS dormie (lead 6 === remaining swing 6)", () => {
    expect(matchState(upN(6), 18, GLOR3)).toMatchObject({ up: 6, over: false, closed: false, dormie: true });
  });
  it("7 up thru 15 IS closed / won (lead 7 > remaining swing 6)", () => {
    expect(matchState(upN(7), 18, GLOR3)).toMatchObject({ up: 7, over: true, closed: true, leader: "A" });
  });
  it("regression: a raw holesUp>holesRemaining impl would wrongly close the 4-up case (4 > 3)", () => {
    // Under NO glorious the SAME 4-up-thru-15 IS closed (4 > 3 raw) — proving the
    // weighted swing is what keeps the glorious game live.
    expect(matchState(upN(4), 18, NO_GLORIOUS)).toMatchObject({ over: true, closed: true });
  });
});

describe("§6c — derive, don't snapshot: same stored outcomes, flip the flag → tally changes", () => {
  it("flipping glorious ON (no re-entry) flips the SAME 6-down match from a B win to a halve", () => {
    const comeback: DecidedHole[] = [...downSix, { hole: 16, result: "W" }, { hole: 17, result: "W" }, { hole: 18, result: "W" }];
    const before = JSON.stringify(comeback); // the stored raw outcomes
    const off = matchState(comeback, 18, NO_GLORIOUS);
    const on = matchState(comeback, 18, GLOR3);
    expect(off.leader).toBe("B"); // eliminated under raw rules
    expect(on.leader).toBe(null); // all square once the last 3 count double
    // Read-side only: the flip touched no stored data (the input is byte-identical).
    expect(JSON.stringify(comeback)).toBe(before);
  });
});

describe("§6e — weighted margin string: X = weighted lead, Y = raw holes-to-play", () => {
  it("no premature close-out string — 4 up thru 15 shows null, not '4&3'", () => {
    expect(matchState(upN(4), 18, GLOR3).margin).toBeNull();
  });
  it("a glorious close-out carries the WEIGHTED lead as X and RAW holes as Y (X can exceed Y)", () => {
    // 3 up thru 15 (swing 6, still live), then win hole 16 (2×) → lead 5, holes-left 2
    // → closed "5&2". Raw rules would read the same close as "4&2" (hole 16 counts 1).
    const win16 = [...upN(3), { hole: 16, result: "W" as HoleResult }];
    expect(matchState(win16, 18, GLOR3)).toMatchObject({ closed: true, margin: "5&2", holesLeft: 2, up: 5 });
    expect(matchState(win16, 18, NO_GLORIOUS).margin).toBe("4&2");
  });
});
