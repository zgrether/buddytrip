import { describe, it, expect } from "vitest";
import {
  saveProgressPercent,
  SAVE_PROGRESS_CEILING,
  SAVE_PROGRESS_DONE,
  SAVE_PROGRESS_TARGET_MS,
} from "./saveProgress";

/**
 * The save bar's progress curve.
 *
 * The properties below are the ones the bar's honesty rests on, and each is
 * asserted as a PROPERTY rather than as a sampled number — a test pinning
 * `saveProgressPercent(10_000) === 71.3` would pass against a linear ramp,
 * a step function, or anything else that happens to cross that point.
 *
 * What must hold:
 *   1. it never reaches the ceiling  — a bar that sits full while the app waits
 *      is the lie this shape exists to avoid
 *   2. it DECELERATES                — the visible signal that it is easing, not
 *      counting down to a deadline
 *   3. it is monotonic               — a bar that goes backwards reads as broken
 *   4. a bad clock reading yields 0  — not NaN, which renders as `width: NaN%`
 */

describe("saveProgressPercent", () => {
  it("starts at zero and never reaches the ceiling, however long the save runs", () => {
    expect(saveProgressPercent(0)).toBe(0);
    // The asymptote is the whole design: 90 is approached, never arrived at.
    expect(saveProgressPercent(SAVE_PROGRESS_TARGET_MS)).toBeLessThan(SAVE_PROGRESS_CEILING);
    expect(saveProgressPercent(SAVE_PROGRESS_TARGET_MS * 10)).toBeLessThan(SAVE_PROGRESS_CEILING);
    // …and a minute in it is still short of it, not stuck AT it.
    expect(saveProgressPercent(60_000)).toBeLessThan(SAVE_PROGRESS_CEILING);
    // Only a returned save shows 100, and this function never produces it.
    expect(saveProgressPercent(60_000)).toBeLessThan(SAVE_PROGRESS_DONE);
  });

  it("DECELERATES — each successive second adds less than the one before", () => {
    // The property that separates this from a linear ramp, which would satisfy
    // "monotonic" and "bounded" equally well.
    const second = (n: number) => saveProgressPercent(n * 1000) - saveProgressPercent((n - 1) * 1000);
    for (let n = 2; n <= 30; n++) {
      expect(second(n), `second ${n} grew more than second ${n - 1}`).toBeLessThan(second(n - 1));
    }
  });

  it("is monotonic across the whole range, including past the target", () => {
    let prev = -1;
    for (let ms = 0; ms <= SAVE_PROGRESS_TARGET_MS * 3; ms += 250) {
      const p = saveProgressPercent(ms);
      expect(p, `went backwards at ${ms}ms`).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("is far enough along at the 20s target to read as nearly-there", () => {
    // Not a sampled constant — a RANGE, which is the actual design intent. Too
    // low and the bar crawls; too high and it parks at the ceiling for every
    // save that runs long.
    const atTarget = saveProgressPercent(SAVE_PROGRESS_TARGET_MS);
    expect(atTarget).toBeGreaterThan(SAVE_PROGRESS_CEILING * 0.9);
    expect(atTarget).toBeLessThan(SAVE_PROGRESS_CEILING * 0.99);
  });

  it("moves visibly in the first second — the tap must feel acknowledged", () => {
    // The failure this guards: an ease so slow that the bar looks stuck at 0 for
    // the first beat, which is the moment it most needs to say something.
    expect(saveProgressPercent(1000)).toBeGreaterThan(5);
  });

  it("returns 0 rather than NaN for a nonsense clock reading", () => {
    // A suspended tab or a clock adjustment can hand this a negative elapsed.
    // NaN would render as `width: NaN%` and the fill would vanish.
    for (const bad of [-1, -60_000, NaN, Infinity, -Infinity]) {
      expect(saveProgressPercent(bad), `${bad}`).toBe(0);
    }
  });
});
