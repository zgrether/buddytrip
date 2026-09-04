import { describe, it, expect } from "vitest";
import { fitName, initialSurname, STEP_2_SIZE, STEP_1_MAX, STEP_2_MAX } from "./nameLadder";

/**
 * WHAT IS AND IS NOT ASSERTABLE HERE, stated so nobody pins the wrong thing.
 *
 * There is no layout engine in this harness (`renderToStaticMarkup`, and the
 * suite runs in `environment: "node"`). So "does the name fit in 130px" is NOT
 * testable, and a test claiming to check it would be measuring nothing.
 *
 * What IS deterministic — and what these assert — is WHICH RUNG the ladder
 * chose for a given string, and what text that rung produces. Whether the
 * thresholds are calibrated correctly is a question for a person looking at a
 * 375px phone; whether the rule is applied consistently is this file's job.
 */

const SHORT = "Brad Giesler"; // 12
const LONG = "Julie Ann Hackett"; // 17
const VERY_LONG = "Bartholomew Fotheringay"; // 23

describe("the ladder", () => {
  it("step 1: a name that fits is left alone, at the surface's own size", () => {
    const fit = fitName(SHORT, 17);
    expect(fit).toEqual({ text: SHORT, fontSize: 17, step: 1 });
  });

  it("step 2: a longer name keeps its full text and steps DOWN one size", () => {
    const fit = fitName(LONG, 17);
    expect(fit.step).toBe(2);
    expect(fit.text).toBe(LONG); // full name — splitting buys width, shrinking is second
    expect(fit.fontSize).toBe(STEP_2_SIZE);
  });

  it("step 3: past the floor it abbreviates to initial + surname", () => {
    const fit = fitName(VERY_LONG, 17);
    expect(fit.step).toBe(3);
    expect(fit.text).toBe("B. Fotheringay");
    expect(fit.fontSize).toBe(STEP_2_SIZE);
  });

  /**
   * THE RULE THE SPEC NAMES EXPLICITLY: the ladder must not shrink names that
   * already fit. Without this, "make everything smaller" passes every other
   * test in this file.
   */
  it("never steps down a name that already fits", () => {
    for (const n of ["Rob", "JD", "Bud Banks", SHORT]) {
      expect(fitName(n, 17).step).toBe(1);
      expect(fitName(n, 17).fontSize).toBe(17);
      expect(fitName(n, 17).text).toBe(n);
    }
  });

  /** Per NAME, not per card — the same reason the spec forbids per-card. */
  it("is per name: a long name beside a short one does not drag the short one down", () => {
    const pair = [SHORT, VERY_LONG].map((n) => fitName(n, 17));
    expect(pair[0].step).toBe(1);
    expect(pair[0].fontSize).toBe(17);
    expect(pair[1].step).toBe(3);
  });

  /** The scorecard starts lower. Step 2 must not make a name BIGGER there. */
  it("never grows a name on a surface whose base is already at or below the step size", () => {
    expect(fitName(LONG, 15).fontSize).toBe(STEP_2_SIZE);
    expect(fitName(LONG, 12).fontSize).toBe(12);
    expect(fitName(LONG, 12).fontSize).toBeLessThanOrEqual(12);
  });

  it("thresholds are the documented ones, not accidental", () => {
    expect(fitName("x".repeat(STEP_1_MAX), 17).step).toBe(1);
    expect(fitName("x".repeat(STEP_1_MAX + 1), 17).step).toBe(2);
    expect(fitName("x".repeat(STEP_2_MAX), 17).step).toBe(2);
    expect(fitName("x".repeat(STEP_2_MAX + 1), 17).step).toBe(3);
  });
});

describe("initialSurname", () => {
  it("drops the middle name, keeps the surname", () => {
    expect(initialSurname("Julie Ann Hackett")).toBe("J. Hackett");
    expect(initialSurname("Matt Facchine")).toBe("M. Facchine");
  });

  /** A name with nothing to abbreviate must not become "C. " or "C. .". */
  it("leaves a single-token name alone", () => {
    expect(initialSurname("Cher")).toBe("Cher");
  });

  it("does not double the period when the first name is already an initial", () => {
    expect(initialSurname("J. Hackett")).toBe("J. Hackett");
    expect(initialSurname("J Hackett")).toBe("J. Hackett");
  });

  /**
   * The floor is reported as step 3 even when it cannot shorten anything —
   * saying step 2 would claim "this fits at the smaller size" about a name the
   * ladder could not actually reduce.
   */
  it("reports step 3 for a long unabbreviable name rather than pretending it fit", () => {
    const fit = fitName("Wolfeschlegelsteinhausenberger", 17);
    expect(fit.step).toBe(3);
    expect(fit.text).toBe("Wolfeschlegelsteinhausenberger");
  });
});
