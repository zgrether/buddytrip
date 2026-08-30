import { describe, it, expect } from "vitest";
import {
  evenShare,
  isPerMatch,
  isPlacement,
  liveMatchPointsPerMatch,
  liveRackPointsPerSlot,
  pointsDivideByMatchRows,
} from "./pointsDistribution";

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


describe("pointsDivideByMatchRows — #1101", () => {
  it("MATCH PLAY and PICK'EM divide by their real match rows", () => {
    // Both write `game_matches`. The leaderboard asked "is this gtt_match_play",
    // which is a different question that shared an answer only while match play
    // was the only format writing them.
    expect(pointsDivideByMatchRows("gtt_match_play")).toBe(true);
    expect(pointsDivideByMatchRows("gtt_pickem")).toBe(true);
  });

  it("RACK does not — and that is its correct answer, not a fallback", () => {
    // Rack has no game_matches rows at all; its sizing is team-size-derived by
    // design, so counting rows would zero it out.
    expect(pointsDivideByMatchRows("gtt_rack_n_stack")).toBe(false);
  });

  it("stroke, non-golf and unknown types do not", () => {
    for (const t of ["gtt_stroke_play", "gtt_generic_card", "gtt_generic_bar", "nope", null, undefined]) {
      expect(pointsDivideByMatchRows(t), String(t)).toBe(false);
    }
  });

  it("PRESERVES every pre-existing answer — this refactor changed one format", () => {
    // The safety property. #1101 was fixed BEFORE Phase 6 precisely so that any
    // behaviour change here is visible on its own; the only id whose answer
    // differs from the old `MATCH_PLAY_TYPES.has(t)` is pick'em, and pick'em is
    // dormant (every game has a null points_distribution, so `isPerMatch` gates
    // the branch out entirely).
    const OLD_MATCH_PLAY_TYPES = new Set(["gtt_match_play"]);
    const ids = [
      "gtt_match_play", "gtt_rack_n_stack", "gtt_stroke_play",
      "gtt_generic_card", "gtt_generic_bar", "gtt_generic_yard", "nope",
    ];
    for (const t of ids) {
      expect(pointsDivideByMatchRows(t), t).toBe(OLD_MATCH_PLAY_TYPES.has(t));
    }
    // ...and pick'em is the one deliberate difference.
    expect(pointsDivideByMatchRows("gtt_pickem")).toBe(true);
    expect(OLD_MATCH_PLAY_TYPES.has("gtt_pickem")).toBe(false);
  });

  it("Matches divides by real rows — same #1101 gap, a third format short", () => {
    // Matches is NOT a game type, unlike gtt_match_play/gtt_pickem — it is a
    // `competitionFormat` descriptor on an otherwise generic type. So the type
    // alone must NOT decide this: a generic card game with no such descriptor
    // stays false (it's an ordinary manual game), and the SAME type WITH the
    // descriptor is true.
    expect(pointsDivideByMatchRows("gtt_generic_card", "matches")).toBe(true);
    expect(pointsDivideByMatchRows("gtt_generic_card", null)).toBe(false);
    expect(pointsDivideByMatchRows("gtt_generic_card")).toBe(false);
    // A descriptor on the WRONG type doesn't count either — resolveResultStrategy
    // only reaches the descriptor for a manual-engine type, and stroke play's
    // engine is fixed by the format regardless of what competition_format says.
    expect(pointsDivideByMatchRows("gtt_stroke_play", "matches")).toBe(false);
  });
});
