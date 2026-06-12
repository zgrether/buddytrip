import { describe, it, expect } from "vitest";
import { effectiveStrokes, clampStrokes, strokeHint } from "./handicap";
import { strokeHoles } from "./matchPlay";

describe("effectiveStrokes", () => {
  it("defaults null to 0", () => {
    expect(effectiveStrokes({ handicap_strokes: null })).toBe(0);
    expect(effectiveStrokes({})).toBe(0);
  });
  it("passes through in-range", () => {
    expect(effectiveStrokes({ handicap_strokes: 7 })).toBe(7);
  });
  it("clamps over the cap and below 0", () => {
    expect(effectiveStrokes({ handicap_strokes: 25 })).toBe(18);
    expect(effectiveStrokes({ handicap_strokes: -3 })).toBe(0);
  });
  it("clampStrokes rounds + clamps", () => {
    expect(clampStrokes(25)).toBe(18);
    expect(clampStrokes(-3)).toBe(0);
    expect(clampStrokes(4.6)).toBe(5);
  });
});

describe("strokeHint", () => {
  const SEQ = Array.from({ length: 18 }, (_, i) => i + 1); // sequential default
  const REAL = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];

  it("no hint at scratch", () => {
    expect(strokeHint(0, 18, REAL)).toBeNull();
  });
  it("every hole at the cap", () => {
    expect(strokeHint(18, 18, REAL)).toBe("a stroke on every hole");
  });
  it("bare count with no index", () => {
    expect(strokeHint(5, 18)).toBe("5 strokes");
  });
  it("first-N phrasing for a sequential index", () => {
    expect(strokeHint(5, 18, SEQ)).toBe("5 strokes · first 5 holes");
  });
  it("names the struck holes for a real index, ≤9", () => {
    // strokeHoles(3, REAL) → holes whose index is 1,2,3 = holes 4, 13, 2.
    const struck = [...strokeHoles(3, REAL)].sort((a, b) => a - b);
    expect(strokeHint(3, 18, REAL)).toBe(`3 strokes · holes ${struck.join(", ")}`);
  });
  it("inverts the list for a real index, >9", () => {
    const struck = new Set(strokeHoles(12, REAL));
    const unstruck = Array.from({ length: 18 }, (_, i) => i + 1).filter((h) => !struck.has(h));
    expect(strokeHint(12, 18, REAL)).toBe(`12 strokes · all but holes ${unstruck.join(", ")}`);
  });
  it("agrees with strokeHoles (named holes are exactly the struck set)", () => {
    const struck = [...strokeHoles(6, REAL)].sort((a, b) => a - b);
    const hint = strokeHint(6, 18, REAL)!;
    for (const h of struck) expect(hint).toContain(String(h));
  });
});
