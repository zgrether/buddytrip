import { describe, it, expect } from "vitest";
import {
  placementGroups,
  placeOfGroup,
  placementsFrom,
  placementPointsByTeam,
} from "./placementGroups";

/**
 * Ties replace the per-row points override that was originally specced. The
 * property that makes them the better mechanism is that the TOTAL IS PRESERVED
 * BY CONSTRUCTION — there is nothing to validate and nothing to refuse — so the
 * tests below check the total explicitly in every shape.
 */

const noTies = new Set<string>();

describe("placementGroups", () => {
  it("makes one group per team when nothing is tied", () => {
    expect(placementGroups(["a", "b", "c"], noTies)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("merges a tied row into the group above it", () => {
    expect(placementGroups(["a", "b", "c"], new Set(["b"]))).toEqual([["a", "b"], ["c"]]);
  });

  it("chains three or more into one group", () => {
    expect(placementGroups(["a", "b", "c", "d"], new Set(["b", "c"]))).toEqual([
      ["a", "b", "c"],
      ["d"],
    ]);
  });

  it("IGNORES a tie flag on the first row", () => {
    // Nothing is above row 0. Handled here so callers never have to prune the
    // set after a drag moves a tied row to the top.
    expect(placementGroups(["a", "b"], new Set(["a"]))).toEqual([["a"], ["b"]]);
  });
});

describe("placeOfGroup — competition-style", () => {
  it("skips places consumed by a tie", () => {
    const groups = placementGroups(["a", "b", "c"], new Set(["b"]));
    expect(placeOfGroup(groups, 0)).toBe(1); // a, b tied 1st
    expect(placeOfGroup(groups, 1)).toBe(3); // c is 3rd, not 2nd
  });
});

describe("placementsFrom", () => {
  it("gives tied teams the SAME position", () => {
    expect(placementsFrom(["a", "b", "c"], new Set(["b"]))).toEqual([
      { entityId: "a", position: 1 },
      { entityId: "b", position: 1 },
      { entityId: "c", position: 3 },
    ]);
  });

  it("is a plain 1..n when nothing is tied", () => {
    expect(placementsFrom(["a", "b"], noTies)).toEqual([
      { entityId: "a", position: 1 },
      { entityId: "b", position: 2 },
    ]);
  });
});

describe("placementPointsByTeam", () => {
  const DIST = [6, 3.5, 1.5];
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it("pays the distribution straight through with no ties", () => {
    const pts = placementPointsByTeam(["a", "b", "c"], noTies, DIST);
    expect(pts.get("a")).toBe(6);
    expect(pts.get("b")).toBe(3.5);
    expect(pts.get("c")).toBe(1.5);
    expect(total(pts)).toBe(11);
  });

  it("SPLITS the pooled slots on a tie, preserving the total", () => {
    // The whole argument for ties over overrides: (6 + 3.5) / 2 = 4.75 each,
    // then 1.5 for third. No validation needed — it cannot fail to sum.
    const pts = placementPointsByTeam(["a", "b", "c"], new Set(["b"]), DIST);
    expect(pts.get("a")).toBe(4.75);
    expect(pts.get("b")).toBe(4.75);
    expect(pts.get("c")).toBe(1.5);
    expect(total(pts)).toBe(11);
  });

  it("preserves the total for a three-way tie too", () => {
    const pts = placementPointsByTeam(["a", "b", "c"], new Set(["b", "c"]), DIST);
    for (const id of ["a", "b", "c"]) expect(pts.get(id)).toBeCloseTo(11 / 3, 10);
    expect(total(pts)).toBeCloseTo(11, 10);
  });

  it("pays nothing to places past the end of the distribution", () => {
    // Four teams, three paid slots. 4th earns nothing — which is why the badge
    // omits it rather than printing a zero.
    const pts = placementPointsByTeam(["a", "b", "c", "d"], noTies, DIST);
    expect(pts.get("d")).toBe(0);
    expect(total(pts)).toBe(11);
  });

  it("a tie spanning the paid/unpaid boundary still preserves the total", () => {
    // The case most likely to be got wrong by a hand-rolled rule: 3rd and 4th
    // tied pool 1.5 + 0 and take 0.75 each.
    const pts = placementPointsByTeam(["a", "b", "c", "d"], new Set(["d"]), DIST);
    expect(pts.get("a")).toBe(6);
    expect(pts.get("b")).toBe(3.5);
    expect(pts.get("c")).toBe(0.75);
    expect(pts.get("d")).toBe(0.75);
    expect(total(pts)).toBe(11);
  });

  it("everyone tied splits the whole pot", () => {
    const pts = placementPointsByTeam(["a", "b"], new Set(["b"]), [6, 4]);
    expect(pts.get("a")).toBe(5);
    expect(pts.get("b")).toBe(5);
    expect(total(pts)).toBe(10);
  });
});
