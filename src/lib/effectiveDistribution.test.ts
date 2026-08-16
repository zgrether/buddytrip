import { describe, it, expect } from "vitest";
import { effectiveDistribution } from "./pointsDistribution";
import { placementPoints } from "./competitionPlacement";

/**
 * A game with no authored split pays its total to first place.
 *
 * The bug: three call sites each wrote `isPlacement(d) ? d.values : []`, and an
 * EMPTY distribution makes `placementPoints` award 0 to everyone. A bracket with
 * no split therefore showed no value in its final's header, no projection on the
 * board, and rolled up nothing — four symptoms, one input.
 */
describe("effectiveDistribution", () => {
  it("passes an authored split through untouched", () => {
    expect(effectiveDistribution({ type: "placement", values: [10, 6, 3] }, 19)).toEqual([10, 6, 3]);
  });

  it("flattens a NULL split to the total — winner takes all", () => {
    expect(effectiveDistribution(null, 8)).toEqual([8]);
    expect(effectiveDistribution(undefined, 8)).toEqual([8]);
  });

  it("treats per_match as unsplit — it is match play's shape, not a placement", () => {
    expect(effectiveDistribution({ type: "per_match", value: 2 }, 8)).toEqual([8]);
  });

  it("a game worth NOTHING stays empty, rather than paying 0 to first", () => {
    // "Unconfigured" and "worth zero" must not both render as a payout of 0.
    expect(effectiveDistribution(null, 0)).toEqual([]);
    expect(effectiveDistribution(null, null)).toEqual([]);
  });

  it("the whole point: scored through placementPoints, first place gets the total", () => {
    // This is the assertion the shipped code failed. With `[]` every entrant got
    // 0; with the flatten the champion gets the lot and the rest get nothing.
    const standings = [
      { entityId: "champion", value: 1 },
      { entityId: "runnerUp", value: 2 },
      { entityId: "third", value: 3 },
      { entityId: "fourth", value: 3 },
    ];
    const paid = placementPoints(effectiveDistribution(null, 8), standings, "low_wins");
    expect(paid.get("champion")).toBe(8);
    expect(paid.get("runnerUp")).toBe(0);
    // A tie beyond the distribution still shares nothing, not NaN.
    expect(paid.get("third")).toBe(0);
    expect(paid.get("fourth")).toBe(0);
  });

  it("the empty array — what shipped — pays the champion NOTHING", () => {
    // Pinned as the regression, so "just use []" cannot come back looking safe.
    const paid = placementPoints([], [{ entityId: "champion", value: 1 }], "low_wins");
    expect(paid.get("champion")).toBe(0);
  });
});
