import { describe, it, expect } from "vitest";
import {
  placementPoints,
  placementDetail,
  awardedForGame,
  winThreshold,
  rollUp,
  type LiveGame,
  type Standing,
} from "./competitionPlacement";

// Build standings where index 0 is best (place 1). `groups` lets us force ties:
// e.g. [1,2,3,3] → teams t0,t1 distinct, t2/t3 tie for 3rd.
function standings(values: number[]): Standing[] {
  return values.map((value, i) => ({ entityId: `t${i}`, value }));
}

describe("placementPoints — averaged ties (§5b)", () => {
  it("reproduces the grid: [9,6,4,2], two tie for 3rd → 9,6,3,3", () => {
    const pts = placementPoints([9, 6, 4, 2], standings([1, 2, 3, 3]), "low_wins");
    expect(pts.get("t0")).toBe(9);
    expect(pts.get("t1")).toBe(6);
    expect(pts.get("t2")).toBe(3); // (4+2)/2
    expect(pts.get("t3")).toBe(3);
  });

  it("sum is invariant under ties (averaging preserves the awarded total)", () => {
    const noTie = placementPoints([9, 6, 4, 2], standings([1, 2, 3, 4]), "low_wins");
    const tie = placementPoints([9, 6, 4, 2], standings([1, 2, 3, 3]), "low_wins");
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(sum(noTie)).toBe(21);
    expect(sum(tie)).toBe(21);
  });

  it("teams beyond the distribution length earn 0", () => {
    const pts = placementPoints([9, 6], standings([1, 2, 3, 4]), "low_wins");
    expect(pts.get("t0")).toBe(9);
    expect(pts.get("t1")).toBe(6);
    expect(pts.get("t2")).toBe(0);
    expect(pts.get("t3")).toBe(0);
  });

  it("a 3-way tie for 1st splits the top three slots evenly", () => {
    const pts = placementPoints([9, 6, 4, 2], standings([5, 5, 5, 9]), "low_wins");
    const share = (9 + 6 + 4) / 3; // 6.333…
    expect(pts.get("t0")).toBeCloseTo(share);
    expect(pts.get("t1")).toBeCloseTo(share);
    expect(pts.get("t2")).toBeCloseTo(share);
    expect(pts.get("t3")).toBe(2);
  });

  it("honors high_wins direction (points-based formats)", () => {
    // Higher value is better → t3 (value 40) wins.
    const pts = placementPoints([9, 6, 4, 2], standings([10, 20, 30, 40]), "high_wins");
    expect(pts.get("t3")).toBe(9);
    expect(pts.get("t0")).toBe(2);
  });

  it("empty standings → no points (Phase-1 shell, not yet played)", () => {
    expect(placementPoints([9, 6, 4, 2], [], "low_wins").size).toBe(0);
  });
});

describe("placementDetail — place + points for the grid cell", () => {
  it("returns the 1-based place and points; tied teams share the group's place", () => {
    const d = placementDetail([9, 6, 4, 2], standings([1, 2, 3, 3]), "low_wins");
    expect(d.get("t0")).toEqual({ place: 1, points: 9 });
    expect(d.get("t1")).toEqual({ place: 2, points: 6 });
    expect(d.get("t2")).toEqual({ place: 3, points: 3 }); // tied 3rd → place 3, (4+2)/2
    expect(d.get("t3")).toEqual({ place: 3, points: 3 });
  });
});

describe("awardedForGame (§6)", () => {
  it("sums distribution over the first numTeams places", () => {
    expect(awardedForGame([9, 6, 4, 2], 4)).toBe(21);
    expect(awardedForGame([9, 6, 4, 2], 2)).toBe(15);
    expect(awardedForGame([9, 6, 4, 2], 6)).toBe(21); // beyond length → +0
    expect(awardedForGame(null, 4)).toBe(0);
    expect(awardedForGame([], 4)).toBe(0);
  });
});

describe("winThreshold (§6)", () => {
  it("clinch by EXCEEDING half → smallest 0.5-step above half", () => {
    expect(winThreshold(28, false)).toBe(14.5); // 28 → 14½
    expect(winThreshold(27, false)).toBe(14); // 13.5 → 14
    expect(winThreshold(21, false)).toBe(11); // 10.5 → 11
  });
  it("defending team clinches at EXACTLY half (tie retains)", () => {
    expect(winThreshold(28, true)).toBe(14); // exactly half
    expect(winThreshold(27, true)).toBe(13.5); // half rounded up to a 0.5 step
  });
});

describe("rollUp — points-available, totals, win number (§6)", () => {
  const game = (id: string, distribution: number[], values: number[]): LiveGame => ({
    id,
    distribution,
    numTeams: 4,
    standings: standings(values),
    direction: "low_wins",
  });
  const teams = ["t0", "t1", "t2", "t3"];

  it("points-available = Σ live-game awarded; totals roll up across games", () => {
    const games = [game("g1", [9, 6, 4, 2], [1, 2, 3, 4]), game("g2", [9, 6, 4, 2], [4, 3, 2, 1])];
    const r = rollUp(games, teams);
    expect(r.pointsAvailable).toBe(42); // 21 + 21
    expect(r.teamTotals.get("t0")).toBe(9 + 2); // 1st in g1, 4th in g2
    expect(r.teamTotals.get("t3")).toBe(2 + 9);
    expect(r.winNumber).toBe(21.5); // > half of 42
  });

  it("DROPPING a game lowers points-available and the win number; restoring raises it (§4)", () => {
    const all = [game("g1", [9, 6, 4, 2], [1, 2, 3, 4]), game("g2", [9, 6, 4, 2], [1, 2, 3, 4])];
    const withDrop = [all[0]]; // g2 dropped → caller passes only live games
    expect(rollUp(all, teams).pointsAvailable).toBe(42);
    expect(rollUp(all, teams).winNumber).toBe(21.5);
    expect(rollUp(withDrop, teams).pointsAvailable).toBe(21);
    expect(rollUp(withDrop, teams).winNumber).toBe(11); // 10.5 → 11; the win number MOVED
    expect(rollUp(all, teams).pointsAvailable).toBe(42); // restore → back up
  });

  it("Phase-1 shell (no standings) still contributes points-available", () => {
    const shell: LiveGame = { id: "shell", distribution: [9, 6, 4, 2], numTeams: 4, standings: [], direction: "low_wins" };
    const r = rollUp([shell], teams);
    expect(r.pointsAvailable).toBe(21); // contributes before anything is played
    expect(r.teamTotals.get("t0")).toBe(0); // …but awards nothing yet
    expect(r.winNumber).toBe(11);
  });

  it("points-to-clinch = winNumber − current; defending team uses the exact-half bar", () => {
    const games = [game("g1", [9, 6, 4, 2], [1, 2, 3, 4])]; // available 21, win 11, defender bar 11(ceil 10.5)
    const r = rollUp(games, teams, { defendingTeamId: "t3" });
    expect(r.pointsToClinch.get("t0")).toBe(11 - 9); // 2 to go
    // available 21 → half 10.5 → defender ceil = 11 as well here; use an even total to show the gap:
    const even = [game("g1", [9, 6, 4, 2], [1, 2, 3, 4]), game("g2", [9, 6, 4, 2], [1, 2, 3, 4])]; // 42
    const r2 = rollUp(even, teams, { defendingTeamId: "t3" });
    expect(r2.winNumber).toBe(21.5); // headline (non-defender) bar
    expect(r2.pointsToClinch.get("t3")).toBe(21 - (r2.teamTotals.get("t3") ?? 0)); // defender: exactly half (21)
    expect(r2.pointsToClinch.get("t0")).toBe(21.5 - (r2.teamTotals.get("t0") ?? 0)); // non-defender: > half
  });
});
