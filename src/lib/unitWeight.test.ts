import { describe, it, expect } from "vitest";
import { matchState, type DecidedHole } from "./matchPlay";
import { toUnitWeight, remainingSwing, NO_GLORIOUS, type UnitWeight } from "./gloriousHoles";

/**
 * The weight is PASSED IN, so a non-golf format can drive the match-play engine.
 *
 * ── What this replaced, and why it is three things and not one ────────────
 *
 * `matchState` used to call `holeWeight(hole, cfg)` directly. That baked three of
 * golf's assumptions into the shared engine, and each one independently blocked
 * pick'em:
 *
 *   1. the return type is the literal `1 | 2` — no third weight exists;
 *   2. the selector is POSITIONAL (`hole > 18 − n`, a trailing window);
 *   3. `ROUND_HOLES` is a hardcoded 18, so a shorter unit count is silently INERT.
 *
 * Pick'em's weights are 1..4, per game, over a 16-game slate — one violation each.
 * The tests below are one per assumption, because a build that fixed only the
 * magnitude (say, widening the literal to `1 | 2 | 3 | 4`) would still fail the
 * other two and would pass any test that only checked a 3× game scoring 3.
 */

const W = (hole: number): DecidedHole => ({ hole, result: "W" });
const L = (hole: number): DecidedHole => ({ hole, result: "L" });

describe("golf is untouched — the config form still works", () => {
  it("weighs every unit 1 under NO_GLORIOUS", () => {
    /**
     * The backward-compatibility claim, asserted rather than assumed: ten
     * existing call sites pass a `GloriousConfig` and none of them changed.
     */
    const st = matchState([W(1), W(2), L(3)], 18, NO_GLORIOUS);
    expect(st.diff).toBe(1);
    expect(st.up).toBe(1);
  });

  it("still doubles the trailing window when glorious is on", () => {
    // Holes 17 and 18 are 2× at n=2, so W(17) + L(18) nets zero and W(1) stands.
    const st = matchState([W(1), W(17), L(18)], 18, { enabled: true, n: 2 });
    expect(st.diff).toBe(1);
  });
});

describe("assumption 1 — a weight may exceed 2", () => {
  it("scores a 4× unit as four", () => {
    /**
     * IMPOSSIBLE BEFORE: `holeWeight` returns `1 | 2`, so there was no value it
     * could have produced here. Pick'em ships `MULTIPLIER_MAX = 4` and the DB
     * allows any positive numeric, so this is a shipped case rather than a
     * hypothetical one.
     */
    const weightOf: UnitWeight = (u) => (u === 2 ? 4 : 1);
    const st = matchState([W(1), L(2)], 16, weightOf);
    expect(st.diff).toBe(-3); // +1 then −4
  });

  it("counts the same weight in the REMAINING swing, not just the played units", () => {
    /**
     * The half that decides close-out. A build that weighted played units but
     * left `remainingSwing` on golf's `1 | 2` would close matches early — the
     * lead would be compared against a swing that understates what is left.
     *
     * Three units left at 4× each is a swing of 12, so a 3-up lead is NOT closed.
     */
    const weightOf: UnitWeight = () => 4;
    expect(remainingSwing([2, 3, 4], weightOf)).toBe(12);

    const st = matchState([W(1)], 4, weightOf);
    expect(st.closed, "4-up with 12 of swing left must stay live").toBe(false);
  });
});

describe("assumption 2 — the selector is per-unit, not positional", () => {
  it("weights a unit at the START of the list, which a trailing window cannot", () => {
    /**
     * Golf's mechanic can only ever double a TRAILING window. A pick'em
     * multiplier sits wherever the runner put the game — commonly the first
     * one on the slate.
     *
     * A build still selecting positionally gives unit 1 a weight of 1 and this
     * reads −1 instead of −2.
     */
    const weightOf: UnitWeight = (u) => (u === 1 ? 2 : 1);
    const st = matchState([L(1)], 16, weightOf);
    expect(st.diff).toBe(-2);
  });
});

describe("assumption 3 — the unit count is not 18", () => {
  it("weights a 16-unit slate, where golf's config is structurally inert", () => {
    /**
     * `holeWeight` measures against a hardcoded `ROUND_HOLES = 18`, so on a
     * 16-game slate NOTHING clears `18 − n` for any n ≤ 2 and the weighting
     * silently does nothing. #1300 relies on exactly this for sub-18 rounds.
     *
     * The pair is the assertion: the config form is inert here (which is
     * correct for golf) and the function form is not. One without the other
     * proves nothing about which mechanism is running.
     */
    const inert = matchState([W(16)], 16, { enabled: true, n: 2 });
    expect(inert.diff, "golf's trailing window cannot reach a 16-unit slate").toBe(1);

    const weightOf: UnitWeight = (u) => (u === 16 ? 2 : 1);
    expect(matchState([W(16)], 16, weightOf).diff).toBe(2);
  });
});

describe("toUnitWeight — the one place the two forms meet", () => {
  it("passes a function through and adapts a config", () => {
    const fn: UnitWeight = (u) => u * 10;
    expect(toUnitWeight(fn)(3)).toBe(30);
    expect(toUnitWeight(NO_GLORIOUS)(18)).toBe(1);
    expect(toUnitWeight({ enabled: true, n: 1 })(18)).toBe(2);
  });
});
