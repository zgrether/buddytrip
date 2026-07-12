import { describe, it, expect } from "vitest";
import { gloriousConfig, holeWeight, remainingSwing, isGloriousHole, NO_GLORIOUS } from "./gloriousHoles";

// The pure weight helper. The tally/close-out consequences (comeback, weighted
// close-out, margin string) are gated in matchPlay.test.ts; this file pins the
// primitives + the format guard (§6 gate d).

describe("gloriousConfig — read + format guard", () => {
  const on = { glorious_holes: { holes: 3 } };

  it("reads enabled + N off a match-play game's modifiers", () => {
    expect(gloriousConfig("gtt_match_play", on)).toEqual({ enabled: true, n: 3 });
    expect(gloriousConfig("gtt_match_play", { glorious_holes: { holes: 5 } })).toEqual({ enabled: true, n: 5 });
  });

  it("legacy `{}` shape reads as the default N=3 (existing rows don't break)", () => {
    expect(gloriousConfig("gtt_match_play", { glorious_holes: {} })).toEqual({ enabled: true, n: 3 });
  });

  it("absent key = disabled (presence-model)", () => {
    expect(gloriousConfig("gtt_match_play", {})).toBe(NO_GLORIOUS);
    expect(gloriousConfig("gtt_match_play", null)).toBe(NO_GLORIOUS);
  });

  it("FORMAT GUARD: inert for stroke / rack / manual even with the flag forced on", () => {
    // Rack is match_play by COMPETITION scoring_model — the trap. Guard is on the id.
    expect(gloriousConfig("gtt_rack_n_stack", on)).toBe(NO_GLORIOUS);
    expect(gloriousConfig("gtt_stroke_play", on)).toBe(NO_GLORIOUS);
    expect(gloriousConfig("gtt_generic_bar", on)).toBe(NO_GLORIOUS);
    expect(gloriousConfig(null, on)).toBe(NO_GLORIOUS);
  });
});

describe("holeWeight", () => {
  const cfg = { enabled: true, n: 3 }; // last 3 → holes 16,17,18 double

  it("2× on the last N holes, 1× elsewhere", () => {
    expect(holeWeight(15, cfg)).toBe(1);
    expect(holeWeight(16, cfg)).toBe(2);
    expect(holeWeight(17, cfg)).toBe(2);
    expect(holeWeight(18, cfg)).toBe(2);
  });

  it("N=1 doubles only the 18th", () => {
    expect(holeWeight(17, { enabled: true, n: 1 })).toBe(1);
    expect(holeWeight(18, { enabled: true, n: 1 })).toBe(2);
  });

  it("disabled → always 1", () => {
    for (const h of [16, 17, 18]) expect(holeWeight(h, NO_GLORIOUS)).toBe(1);
  });
});

describe("remainingSwing — over the actual unplayed-hole set", () => {
  const cfg = { enabled: true, n: 3 };

  it("sums each unplayed hole's weight (not a scalar count)", () => {
    // holes 16,17,18 left → 2+2+2 = 6 weighted swing
    expect(remainingSwing([16, 17, 18], cfg)).toBe(6);
    // holes 14,15 left → 1+1 = 2
    expect(remainingSwing([14, 15], cfg)).toBe(2);
  });

  it("counts a GAP correctly — an unplayed glorious hole mid-set keeps its 2×", () => {
    // 16 undecided while 17,18 are decided → remaining unplayed {16} = weight 2,
    // NOT 1 (a scalar 'one hole left' would undercount the swing).
    expect(remainingSwing([16], cfg)).toBe(2);
    // mixed gap: holes 15 and 18 unplayed → 1 + 2 = 3
    expect(remainingSwing([15, 18], cfg)).toBe(3);
  });

  it("with no glorious, weighted swing == raw hole count", () => {
    expect(remainingSwing([16, 17, 18], NO_GLORIOUS)).toBe(3);
  });
});

describe("isGloriousHole — the ONE predicate the visual layer must call", () => {
  const cfg = { enabled: true, n: 3 }; // last 3 → holes 16,17,18

  it("true on the last N holes, false elsewhere", () => {
    expect(isGloriousHole(15, cfg)).toBe(false);
    expect(isGloriousHole(16, cfg)).toBe(true);
    expect(isGloriousHole(17, cfg)).toBe(true);
    expect(isGloriousHole(18, cfg)).toBe(true);
  });

  it("always false when disabled", () => {
    for (const h of [16, 17, 18]) expect(isGloriousHole(h, NO_GLORIOUS)).toBe(false);
  });

  it("agrees with holeWeight (it's a thin wrapper, not a second source of truth)", () => {
    for (let h = 1; h <= 18; h++) expect(isGloriousHole(h, cfg)).toBe(holeWeight(h, cfg) === 2);
  });
});
