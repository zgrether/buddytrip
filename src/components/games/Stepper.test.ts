import { describe, it, expect } from "vitest";
import { stepperBounds, STEPPER_SIZES } from "./Stepper";

// W-GAMEPAGE visual pass P-B (vocabulary §6) — the canonical stepper. These lock
// the clamp/disabled logic that every migrated call site shares, so unification
// can't change a floor/ceiling. (Node test env has no RTL; the pure bounds are
// the migration-equivalence core.)

describe("stepperBounds", () => {
  it("disables − at the floor, + at the ceiling", () => {
    expect(stepperBounds(0, 0, 18).atFloor).toBe(true); // roster scratch
    expect(stepperBounds(1, 0, 18).atFloor).toBe(false);
    expect(stepperBounds(18, 0, 18).atCeil).toBe(true);
    expect(stepperBounds(17, 0, 18).atCeil).toBe(false);
  });

  it("no max → + never hits a ceiling", () => {
    expect(stepperBounds(9999, 1).atCeil).toBe(false);
  });

  it("clamps the next value into [min, max]", () => {
    expect(stepperBounds(0, 0, 18).decValue).toBe(0); // can't go below the floor
    expect(stepperBounds(18, 0, 18).incValue).toBe(18); // can't exceed the ceiling
    expect(stepperBounds(3, 1, 9).decValue).toBe(2);
    expect(stepperBounds(3, 1, 9).incValue).toBe(4);
  });

  it("honors a custom step", () => {
    expect(stepperBounds(4, 0, 18, 2).incValue).toBe(6);
    expect(stepperBounds(1, 0, 18, 2).decValue).toBe(0); // clamps, doesn't go to -1
  });

  it("covers the four migrated call sites' floors", () => {
    expect(stepperBounds(1, 1).atFloor).toBe(true); // PointStepper / RelHandicap min=1
    expect(stepperBounds(0, 0, 18).atFloor).toBe(true); // HandicapRoster min=0 (SCR)
    expect(stepperBounds(1, 1, 9).atFloor).toBe(true); // ModifierCards glorious_holes min=1
  });

  it("inline Points control (Phase C): min 0, no max — `−` disabled at 0, `+` always free", () => {
    expect(stepperBounds(0, 0).atFloor).toBe(true); // can't go below 0 points
    expect(stepperBounds(0, 0).decValue).toBe(0); // clamps at the floor
    expect(stepperBounds(0, 0).atCeil).toBe(false); // no ceiling
    expect(stepperBounds(0, 0).incValue).toBe(1); // `+` lifts it out of empty
  });
});

describe("STEPPER_SIZES", () => {
  it("three densities, distinct button + number sizes; inline is right-aligned", () => {
    expect(STEPPER_SIZES.full.btn).toBeGreaterThan(STEPPER_SIZES.compact.btn);
    expect(STEPPER_SIZES.full.align).toBe("center");
    expect(STEPPER_SIZES.compact.align).toBe("center");
    expect(STEPPER_SIZES.inline.align).toBe("right");
  });
});
