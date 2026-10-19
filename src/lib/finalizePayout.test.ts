import { describe, it, expect } from "vitest";
import { placementPayout } from "./finalizePayout";

/**
 * #1639 — what a placement game will pay at finalize: each finisher's points,
 * the places nobody can occupy, and whether it pays nothing at all. The points
 * come from the cup's own `placementPoints`, so ties average as the roll-up does.
 */

describe("placementPayout", () => {
  it("pays each finisher its place, and nothing is unpaid when every place is filled", () => {
    const p = placementPayout([5, 3, 1], [
      { unitId: "A", position: 1 },
      { unitId: "B", position: 2 },
      { unitId: "C", position: 3 },
    ]);
    expect(p.lines).toEqual([
      { unitId: "A", place: 1, points: 5 },
      { unitId: "B", place: 2, points: 3 },
      { unitId: "C", place: 3, points: 1 },
    ]);
    expect(p.unpaid).toEqual([]);
    expect(p.paid).toBe(9);
    expect(p.paysNothing).toBe(false);
  });

  it("names a place past the last finisher as unpaid, with how many finished", () => {
    const p = placementPayout([5, 3, 1], [
      { unitId: "A", position: 1 },
      { unitId: "B", position: 2 },
    ]);
    expect(p.unpaid).toEqual([{ place: 3, points: 1, finishers: 2 }]);
    expect(p.paid).toBe(8);
  });

  it("averages a tie exactly as the cup does", () => {
    const p = placementPayout([6, 4, 2], [
      { unitId: "A", position: 1 },
      { unitId: "B", position: 2 },
      { unitId: "C", position: 2 },
    ]);
    expect(p.lines.map((l) => [l.unitId, l.place, l.points])).toEqual([
      ["A", 1, 6],
      ["B", 2, 3],
      ["C", 2, 3],
    ]);
    expect(p.unpaid).toEqual([]);
  });

  it("a game nobody finished pays nothing, and says every place is unpaid", () => {
    const p = placementPayout([5, 3], []);
    expect(p.paysNothing).toBe(true);
    expect(p.paid).toBe(0);
    expect(p.unpaid).toEqual([
      { place: 1, points: 5, finishers: 0 },
      { place: 2, points: 3, finishers: 0 },
    ]);
  });

  it("CONTROL: a split worth nothing is not 'pays nothing' (nothing was on offer)", () => {
    expect(placementPayout([0, 0], []).paysNothing).toBe(false);
  });

  it("a zero-value place past the last finisher is not listed as unpaid", () => {
    expect(placementPayout([5, 0], [{ unitId: "A", position: 1 }]).unpaid).toEqual([]);
  });
});
