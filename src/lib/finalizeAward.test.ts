import { describe, it, expect } from "vitest";
import { placementAward, placementFinalize } from "./finalizeAward";

/**
 * #1639 — what a placement game will award at finalize: each finisher's points,
 * the places nobody can occupy, and whether it awards nothing at all. The points
 * come from the cup's own `placementPoints`, so ties average as the roll-up does.
 */

describe("placementAward", () => {
  it("awards each finisher its place, and nothing is unawarded when every place is filled", () => {
    const p = placementAward([5, 3, 1], [
      { unitId: "A", position: 1 },
      { unitId: "B", position: 2 },
      { unitId: "C", position: 3 },
    ]);
    expect(p.lines).toEqual([
      { unitId: "A", place: 1, points: 5 },
      { unitId: "B", place: 2, points: 3 },
      { unitId: "C", place: 3, points: 1 },
    ]);
    expect(p.unawarded).toEqual([]);
    expect(p.awarded).toBe(9);
    expect(p.awardsNothing).toBe(false);
  });

  it("names a place past the last finisher as unawarded, with how many finished", () => {
    const p = placementAward([5, 3, 1], [
      { unitId: "A", position: 1 },
      { unitId: "B", position: 2 },
    ]);
    expect(p.unawarded).toEqual([{ place: 3, points: 1, finishers: 2 }]);
    expect(p.awarded).toBe(8);
  });

  it("averages a tie exactly as the cup does", () => {
    const p = placementAward([6, 4, 2], [
      { unitId: "A", position: 1 },
      { unitId: "B", position: 2 },
      { unitId: "C", position: 2 },
    ]);
    expect(p.lines.map((l) => [l.unitId, l.place, l.points])).toEqual([
      ["A", 1, 6],
      ["B", 2, 3],
      ["C", 2, 3],
    ]);
    expect(p.unawarded).toEqual([]);
  });

  it("a game nobody finished awards nothing, and says every place is unawarded", () => {
    const p = placementAward([5, 3], []);
    expect(p.awardsNothing).toBe(true);
    expect(p.awarded).toBe(0);
    expect(p.unawarded).toEqual([
      { place: 1, points: 5, finishers: 0 },
      { place: 2, points: 3, finishers: 0 },
    ]);
  });

  it("CONTROL: a split worth nothing is not 'awards nothing' (nothing was on offer)", () => {
    expect(placementAward([0, 0], []).awardsNothing).toBe(false);
  });

  it("a zero-value place past the last finisher is not listed as unawarded", () => {
    expect(placementAward([5, 0], [{ unitId: "A", position: 1 }]).unawarded).toEqual([]);
  });
});

describe("placementFinalize — the schedule the board pays (#1674)", () => {
  const ranked = [{ unitId: "A", position: 1 }, { unitId: "B", position: 2 }];

  it("an authored split is summarised", () => {
    const r = placementFinalize({ distribution: { type: "placement", values: [6, 3] }, pointsTotal: 9, ranked });
    expect(r.award?.lines.map((l) => [l.unitId, l.points])).toEqual([["A", 6], ["B", 3]]);
    expect(r.awardsNothing).toBe(false);
  });

  it("points with NO split award nothing, so Save asks, and no payout is promised", () => {
    // The board's placement arm pays nothing here; winner-takes-all would be a lie.
    const r = placementFinalize({ distribution: null, pointsTotal: 9, ranked });
    expect(r.award).toBeNull();
    expect(r.awardsNothing).toBe(true);
  });

  it("a game worth nothing, with no split, has nothing to summarise and nothing to ask", () => {
    expect(placementFinalize({ distribution: null, pointsTotal: 0, ranked })).toEqual({ award: null, awardsNothing: false });
  });

  it("a per-match shape is not a placement schedule", () => {
    const r = placementFinalize({ distribution: { type: "per_match", value: 2 }, pointsTotal: 6, ranked });
    expect(r.award).toBeNull();
  });

  it("nobody ranked against a real split: every place unawarded, and Save asks", () => {
    const r = placementFinalize({ distribution: { type: "placement", values: [6, 3] }, pointsTotal: 9, ranked: [] });
    expect(r.awardsNothing).toBe(true);
    expect(r.award?.unawarded.map((u) => u.place)).toEqual([1, 2]);
  });
});
