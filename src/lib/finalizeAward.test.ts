import { describe, it, expect } from "vitest";
import { placementAward } from "./finalizeAward";

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
