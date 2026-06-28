import { describe, it, expect } from "vitest";
import { relHandicapView } from "./RelHandicapControl";

// W-GAMEPAGE visual pass P-D §8 — the altitude-aware reveal. Pure view-model so the
// "Even = one line (no stepper)" vs "side = stepper + recipient caption" logic is
// testable apart from render. (The segment outline + avatars are CSS — eye-verified.)
describe("relHandicapView (the §8 reveal view-model)", () => {
  it("Even (value 0): no stepper, no recipient, the muted Even caption", () => {
    const v = relHandicapView(0, "Ann", "Bob");
    expect(v.side).toBe("even");
    expect(v.even).toBe(true);
    expect(v.showStepper).toBe(false); // Even is ONE line — no stepper rendered
    expect(v.recipient).toBeNull();
    expect(v.holes).toEqual([]);
    expect(v.caption).toBe("Even match — no strokes given");
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

  it("clamps magnitude to ±18 and rounds, preserving side", () => {
    expect(relHandicapView(25, "Ann", "Bob").n).toBe(18);
    expect(relHandicapView(25, "Ann", "Bob").side).toBe("b");
    expect(relHandicapView(-25, "Ann", "Bob").n).toBe(18);
    expect(relHandicapView(-25, "Ann", "Bob").side).toBe("a");
    expect(relHandicapView(2.4, "Ann", "Bob").n).toBe(2); // rounds
  });
});
