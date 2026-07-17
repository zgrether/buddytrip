import { describe, it, expect } from "vitest";
import { relHandicapView } from "./RelHandicapControl";

// W-GAMEPAGE visual pass P-D §8, revised by row-pattern Phase 3 — the altitude-aware
// reveal. Pure view-model so the "Even = just the row (no stepper, no caption)" vs
// "side = stepper + recipient caption" logic is testable apart from render. (The
// teal-fill selection + the shared chip/gutter are CSS — eye-verified.)
describe("relHandicapView (the §8 reveal view-model)", () => {
  it("Even (value 0): no stepper, no recipient, NO caption (P3b dropped it)", () => {
    const v = relHandicapView(0, "Ann", "Bob");
    expect(v.side).toBe("even");
    expect(v.even).toBe(true);
    expect(v.showStepper).toBe(false); // Even is JUST the row — no stepper rendered
    expect(v.recipient).toBeNull();
    expect(v.holes).toEqual([]);
    // The "Even match — no strokes given" caption was dropped — the selected Even
    // segment already says it, so an Even match is one line with no caption beneath.
    expect(v.caption).toBe("");
  });

  it("left side (value < 0): side a gets strokes; stepper shows; recipient caption", () => {
    const v = relHandicapView(-3, "Ann", "Bob");
    expect(v.side).toBe("a");
    expect(v.n).toBe(3);
    expect(v.showStepper).toBe(true); // a side reveals the centered stepper
    expect(v.recipient).toBe("Ann");
    expect(v.holes).toHaveLength(3);
    expect(v.caption).toBe(`Ann gets strokes on holes ${v.holes.join(", ")}`); // plural
  });

  it("right side (value > 0): side b; singular 'hole' at n=1", () => {
    const v = relHandicapView(1, "Ann", "Bob");
    expect(v.side).toBe("b");
    expect(v.n).toBe(1);
    expect(v.recipient).toBe("Bob");
    expect(v.caption).toMatch(/^Bob gets strokes on hole \d+$/); // singular, no trailing 's'
  });

  it("names the STROKE-INDEX holes, not sequential 1..n, when a course index is given", () => {
    // Stroke index over 4 holes: SI 1 is hole 3, SI 2 is hole 1, SI 3 is hole 4, SI 4 is
    // hole 2. 2 strokes fall on the two LOWEST-index holes → SI 1 (hole 3) + SI 2 (hole 1).
    const idx = [2, 4, 1, 3];
    const v = relHandicapView(-2, "Ann", "Bob", idx, 4);
    expect(v.holes).toEqual([1, 3]); // NOT [1, 2] — the sequential fallback (the bug)
    expect(v.caption).toBe("Ann gets strokes on holes 1, 3");
  });

  it("falls back to sequential 1..n for an index-less course (matches the engine)", () => {
    // No index passed (or an index-less/muni course) → holes 1..n, exactly what
    // strokeHoles + the scoring engine do when the snapshot has no handicap_index.
    const v = relHandicapView(-3, "Ann", "Bob");
    expect(v.holes).toEqual([1, 2, 3]);
  });

  it("clamps magnitude to ±18 and rounds, preserving side", () => {
    expect(relHandicapView(25, "Ann", "Bob").n).toBe(18);
    expect(relHandicapView(25, "Ann", "Bob").side).toBe("b");
    expect(relHandicapView(-25, "Ann", "Bob").n).toBe(18);
    expect(relHandicapView(-25, "Ann", "Bob").side).toBe("a");
    expect(relHandicapView(2.4, "Ann", "Bob").n).toBe(2); // rounds
  });
});
