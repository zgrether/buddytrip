import { describe, expect, it, vi } from "vitest";
import { largestFittingSize, NAME_SIZES } from "./useShrinkToFit";

/**
 * WHAT THIS FILE COVERS, AND WHAT IT DOES NOT.
 *
 * Covered: `largestFittingSize` — the choice. Given a ladder and a fit
 * predicate, does it pick the largest size that fits, and what does it do when
 * none do.
 *
 * NOT covered: the measuring. `useShrinkToFit` asks the DOM whether a
 * `line-clamp` is currently hiding anything (`scrollHeight > clientHeight`),
 * and jsdom has no layout engine — every height is 0, so the predicate would
 * report that everything fits at full size and a test of it would assert
 * exactly nothing while looking green. That is the "harness cannot reach this
 * layer" case in CLAUDE.md, so it is stated here instead of faked: the hook is
 * verified by rendering in a real browser, and the numbers from that run are in
 * the commit and in `CompetitionHero`'s comments.
 *
 * The split is the point — the part that can be tested was pulled out of the
 * part that cannot, rather than leaving one untestable lump.
 */
describe("largestFittingSize", () => {
  it("takes the first size that fits and asks about no smaller one", () => {
    const asked: number[] = [];
    const chosen = largestFittingSize([17, 16, 15, 14], (s) => {
      asked.push(s);
      return s <= 15;
    });

    expect(chosen).toBe(15);
    // The ladder is largest-first and stops on the first success — so 14 is
    // never measured. Asserting the CALLS, not just the result: a version that
    // measured every size and took the max would return 15 too, and forcing a
    // reflow per candidate when it already has its answer is the cost this
    // shape exists to avoid.
    expect(asked).toEqual([17, 16, 15]);
  });

  it("returns the full size without shrinking when the name already fits", () => {
    const fits = vi.fn(() => true);
    expect(largestFittingSize(NAME_SIZES, fits)).toBe(17);
    // Exactly one measurement in the common case — every name in use fits at 17.
    expect(fits).toHaveBeenCalledTimes(1);
  });

  it("falls back to the floor when nothing fits, rather than the full size", () => {
    // The degenerate case, and the one with a wrong answer that looks right:
    // returning `sizes[0]` here would leave a name at full size overflowing its
    // box — which is the bug this hook replaces, reintroduced by its own
    // fallback. The floor clips instead, which is the old behaviour and the
    // deliberate backstop.
    expect(largestFittingSize([17, 16, 15, 11], () => false)).toBe(11);
  });

  it("refuses an empty ladder instead of returning undefined", () => {
    // Typed as `number`, so an empty array would hand back `undefined` wearing
    // a number's type and land in a `fontSize` — the silent-empty case
    // CLAUDE.md keeps recording. Loud instead.
    expect(() => largestFittingSize([], () => true)).toThrow(/must not be empty/);
  });

  it("does not assume the ladder is the default one", () => {
    // The collapsed bar passes its own (14-based) ladder. A version that
    // hardcoded NAME_SIZES would pass every test above and silently render the
    // sticky bar at the expanded hero's 17.
    expect(largestFittingSize([14, 13, 12, 11], (s) => s <= 12)).toBe(12);
  });
});
