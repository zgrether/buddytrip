import { describe, it, expect } from "vitest";
import { evenShare, isPerMatch, isPlacement } from "./pointsDistribution";

// A2b — the derived even share for non-overridden matches:
//   (total − Σ overrides) ÷ (matchCount − overrideCount).
describe("evenShare (A2b Total Points model)", () => {
  it("splits the whole total when there are NO overrides", () => {
    expect(evenShare(16, [], 8)).toBe(2); // clean: 16 ÷ 8
  });

  it("redistributes the REMAINDER after overrides, keeping the total locked (Buddy)", () => {
    // 16 total, one match overridden to 4 → the other 6 split (16 − 4) = 12 → 2 each.
    expect(evenShare(16, [4], 7)).toBe(2);
  });

  it("handles multiple overrides", () => {
    // 20 total, two overrides (5, 3) → remainder 12 across 4 → 3 each.
    expect(evenShare(20, [5, 3], 6)).toBe(3);
  });

  it("surfaces an HONEST fraction, never rounded", () => {
    expect(evenShare(16, [], 7)).toBeCloseTo(2.2857, 3); // 16 ÷ 7
  });

  it("returns 0 when EVERY match is overridden (no even share to spread)", () => {
    expect(evenShare(16, [8, 8], 2)).toBe(0);
  });

  it("returns 0 with no matches", () => {
    expect(evenShare(16, [], 0)).toBe(0);
  });

  it("can go negative if overrides exceed the total (honest, caller/UI flags it)", () => {
    // 10 total, one override of 12 → remainder −2 across 1 non-overridden → −2.
    expect(evenShare(10, [12], 2)).toBe(-2);
  });
});

// The tagged-shape guards are unchanged by A2b — a quick regression that reuse
// didn't perturb them.
describe("distribution shape guards", () => {
  it("isPerMatch / isPlacement discriminate", () => {
    expect(isPerMatch({ type: "per_match", value: 2 })).toBe(true);
    expect(isPerMatch({ type: "placement", values: [5, 3] })).toBe(false);
    expect(isPlacement({ type: "placement", values: [5, 3] })).toBe(true);
    expect(isPlacement(null)).toBe(false);
  });
});
