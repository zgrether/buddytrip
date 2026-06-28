import { describe, it, expect } from "vitest";
import { isMatchFilled, filledMatches, allMatchesFilled, matchPlayReady, hasValidMatch, type MatchSides } from "./matchDraft";

// Readiness rework P1b — the ONE match-play readiness threshold, shared by the
// setup-page Enable gate and the server `isConfigured` so they can't drift.
// Readiness rework P3 — the downstream gate (Points/Handicaps/Modifiers locked
// until a valid match exists).
describe("hasValidMatch (the downstream gate)", () => {
  const s = (a: string[], b: string[]): MatchSides => ({ a, b });
  it("true only when ≥1 match is fully paired", () => {
    expect(hasValidMatch([s(["x"], ["y"])], 1)).toBe(true); // 1 paired
    expect(hasValidMatch([s(["x"], ["y"]), s([], [])], 1)).toBe(true); // ≥1 paired (the other empty)
  });
  it("false at zero paired — incl. a seeded-but-empty match", () => {
    expect(hasValidMatch([s([], [])], 1)).toBe(false); // seeded empty only
    expect(hasValidMatch([s(["x"], [])], 1)).toBe(false); // half-paired only
    expect(hasValidMatch([], 1)).toBe(false);
  });
});

describe("matchPlayReady (the shared threshold)", () => {
  it("ready only when there is ≥1 match AND every match is paired (paired === total)", () => {
    expect(matchPlayReady(5, 5)).toBe(true); // all paired
    expect(matchPlayReady(3, 5)).toBe(false); // partial — was wrongly "ready" on the list before
    expect(matchPlayReady(0, 1)).toBe(false); // a seeded-but-empty match is not ready
    expect(matchPlayReady(0, 0)).toBe(false); // nothing to score
    expect(matchPlayReady(1, 1)).toBe(true);
  });
});

// W-GAMEPAGE-01 §6.1/§7 — the hard-block readiness gate. An empty or half-filled
// match must keep "Enable scoring" disabled (no silent collapse to the filled
// count). These guard the pure rule the setup face derives the gate from.

const singles = (a: string[], b: string[]): MatchSides => ({ a, b });

describe("isMatchFilled", () => {
  it("singles (1 per side): filled only when both sides have a player", () => {
    expect(isMatchFilled(singles(["x"], ["y"]), 1)).toBe(true);
    expect(isMatchFilled(singles([], ["y"]), 1)).toBe(false);
    expect(isMatchFilled(singles(["x"], []), 1)).toBe(false);
    expect(isMatchFilled(singles([], []), 1)).toBe(false);
  });

  it("2v2 (2 per side): a half-filled side is not full strength", () => {
    expect(isMatchFilled(singles(["a", "b"], ["c", "d"]), 2)).toBe(true);
    expect(isMatchFilled(singles(["a"], ["c", "d"]), 2)).toBe(false);
    expect(isMatchFilled(singles(["a", "b"], ["c"]), 2)).toBe(false);
  });
});

describe("filledMatches", () => {
  it("returns only the fully-paired matches, preserving order", () => {
    const draft = [
      singles(["a"], ["b"]),
      singles(["c"], []),
      singles(["d"], ["e"]),
    ];
    const out = filledMatches(draft, 1);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(draft[0]);
    expect(out[1]).toBe(draft[2]);
  });
});

describe("allMatchesFilled (the Enable-scoring gate)", () => {
  it("is FALSE for an empty draft (nothing to score)", () => {
    expect(allMatchesFilled([], 1)).toBe(false);
  });

  it("is TRUE when every match is fully paired", () => {
    expect(allMatchesFilled([singles(["a"], ["b"]), singles(["c"], ["d"])], 1)).toBe(true);
  });

  it("HARD-BLOCKS: a single unfilled slot anywhere disables the gate", () => {
    // The just-added empty match (build-as-you-go) keeps the gate shut...
    expect(allMatchesFilled([singles(["a"], ["b"]), singles([], [])], 1)).toBe(false);
    // ...as does a half-filled trailing match.
    expect(allMatchesFilled([singles(["a"], ["b"]), singles(["c"], [])], 1)).toBe(false);
    // ...and an unfilled match in the MIDDLE (not just the trailing one).
    expect(allMatchesFilled([singles(["a"], ["b"]), singles([], ["x"]), singles(["c"], ["d"])], 1)).toBe(false);
  });

  it("2v2: every side must be at full strength", () => {
    expect(allMatchesFilled([singles(["a", "b"], ["c", "d"])], 2)).toBe(true);
    expect(allMatchesFilled([singles(["a", "b"], ["c"])], 2)).toBe(false);
  });
});
