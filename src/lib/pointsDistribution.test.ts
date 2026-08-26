import { describe, it, expect } from "vitest";
import { evenShare, isPerMatch, isPlacement, liveMatchPointsPerMatch, liveRackPointsPerSlot } from "./pointsDistribution";

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

/**
 * #1031 — the LIVE per-match/per-slot value, recomputed from the game's CURRENT
 * assigned matches / slot count. This is what every reader (settings row,
 * game-page card + projection, the board's live pill, and the award write) must
 * call instead of reading a persisted `points_distribution.value` snapshot —
 * these tests pin the arithmetic; the integration tests
 * (`matches.pointsA2b.liveCount.test.ts`, `rackNStack.pointsTotal.test.ts`)
 * prove it against the real DB and the real vacate path.
 */
describe("liveMatchPointsPerMatch (#1031 — recomputed from CURRENT assigned matches)", () => {
  const m = (sideAId: string | null, sideBId: string | null, pointValue: number | null = null) => ({
    sideAId,
    sideBId,
    pointValue,
  });

  it("2 matches, total 3, no overrides → 1.5 each (the reported repro's starting state)", () => {
    expect(liveMatchPointsPerMatch(3, [m("a1", "b1"), m("a2", "b2")])).toBe(1.5);
  });

  it("one of those 2 matches drops out (a side goes null) — the SAME total now derives 3, not 1.5", () => {
    // Mirrors a seat vacate: match 2's side_b nulled, match 1 untouched. The
    // divisor moves from 2 assigned matches to 1 with NO other input changing —
    // this is the exact bug: the persisted snapshot stayed at 1.5.
    expect(liveMatchPointsPerMatch(3, [m("a1", "b1"), m("a2", null)])).toBe(3);
  });

  it("a total `game_matches` row that was never assigned doesn't count toward the divisor", () => {
    // An empty/seeded-but-unpaired slot is builder scaffolding, not a match —
    // same predicate `matchCountByGame` ("a match = assigned, everywhere") and
    // the award loop's own `if (!a?.id || !b?.id) continue` already use.
    expect(liveMatchPointsPerMatch(6, [m("a1", "b1"), m(null, null)])).toBe(6); // 6/1, not 6/2
  });

  it("an override is honored — the fallback covers only the non-overridden matches", () => {
    expect(liveMatchPointsPerMatch(6, [m("a1", "b1", 4), m("a2", "b2")])).toBe(2); // (6−4)/1
  });

  it("no assigned matches → 0 (never NaN/Infinity)", () => {
    expect(liveMatchPointsPerMatch(6, [])).toBe(0);
    expect(liveMatchPointsPerMatch(6, [m("a1", null)])).toBe(0);
  });

  it("no total set → 0, regardless of assigned matches", () => {
    expect(liveMatchPointsPerMatch(null, [m("a1", "b1")])).toBe(0);
    expect(liveMatchPointsPerMatch(undefined, [m("a1", "b1")])).toBe(0);
  });

  it("no total set, but a legacy value IS given → the legacy value, untouched by the divisor", () => {
    // A pre-A2b game has no owner-set total to derive an even share FROM — this
    // is the one case that still trusts the persisted points_distribution.value,
    // matching competitionLeaderboard.ts's own `points_total ?? value * mc`
    // carve-out. The match count is irrelevant here on purpose.
    expect(liveMatchPointsPerMatch(null, [m("a1", "b1"), m("a2", "b2")], 2)).toBe(2);
  });

  it("a total IS set → the legacy value is ignored even if present", () => {
    expect(liveMatchPointsPerMatch(4, [m("a1", "b1"), m("a2", "b2")], 999)).toBe(2); // 4/2, not 999
  });
});

describe("liveRackPointsPerSlot (#1031 — recomputed from the CURRENT slot count)", () => {
  it("total ÷ slot count, no overrides (rack has none)", () => {
    expect(liveRackPointsPerSlot(10, 2)).toBe(5);
  });

  it("a shrinking roster (a seat vacate) moves the divisor with the SAME total", () => {
    // Mirrors a seat vacate dropping one team from 2 players to 1 → slot count
    // min(2,1)=1. The persisted snapshot (10/2=5) would be stale; this is live.
    expect(liveRackPointsPerSlot(10, 1)).toBe(10);
  });

  it("zero slots → 0, never NaN/Infinity", () => {
    expect(liveRackPointsPerSlot(10, 0)).toBe(0);
  });

  it("no total set → 0", () => {
    expect(liveRackPointsPerSlot(null, 2)).toBe(0);
  });

  it("no total set, but a legacy value IS given → the legacy value, untouched by the slot count", () => {
    expect(liveRackPointsPerSlot(null, 2, 3)).toBe(3);
  });

  it("a total IS set → the legacy value is ignored even if present", () => {
    expect(liveRackPointsPerSlot(10, 2, 999)).toBe(5); // 10/2, not 999
  });
});
