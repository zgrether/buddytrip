import { describe, it, expect } from "vitest";
import { pickemCardModel, pickemWeightedUnit } from "./pickemMatchCard";
import { matchState } from "./matchPlay";
import type { BoardRow } from "./pickemBoard";

/**
 * The adapter that lets golf's engine score a pick'em match.
 *
 * ── What it must NOT do ───────────────────────────────────────────────────
 *
 * Score anything. `swing`'s MAGNITUDE is deliberately thrown away and only its
 * SIGN is kept, so the weighting happens once — in `matchState`, through
 * `weightOf` — rather than twice in two places that must agree. A build that
 * carried the magnitude through would pass every total assertion here and would
 * be a second scoring implementation, which is the whole thing taking the seam
 * avoided.
 */

const row = (over: Partial<BoardRow> & { slateGameId: string }): BoardRow => ({
  result: null,
  multiplier: 1,
  aPick: "home",
  bPick: "home",
  aConfidence: null,
  bConfidence: null,
  aPoints: 0,
  bPoints: 0,
  swing: 0,
  zeroKind: null,
  upsideA: 0,
  upsideB: 0,
  ...over,
});

const slate = (...specs: [string, number][]) =>
  specs.map(([id, multiplier]) => ({ id, multiplier }));

describe("the mapping — a game is a hole", () => {
  it("turns a gain for A into W and a gain for B into L", () => {
    const model = pickemCardModel(slate(["g1", 1], ["g2", 1]), [
      row({ slateGameId: "g1", result: "home", swing: 1 }),
      row({ slateGameId: "g2", result: "away", swing: -1 }),
    ]);
    expect(model.results).toEqual([
      { hole: 1, result: "W" },
      { hole: 2, result: "L" },
    ]);
  });

  it("leaves an unresolved game OUT, so the engine counts it as still to come", () => {
    /**
     * Absence is how `matchState` already distinguishes "still to come" from
     * "drawn" — the same contract `buildDecided` follows. A build that emitted
     * "H" for an unplayed game would report the match as finished.
     */
    const model = pickemCardModel(slate(["g1", 1], ["g2", 1]), [
      row({ slateGameId: "g1", result: "home", swing: 1 }),
      row({ slateGameId: "g2" }),
    ]);
    expect(model.results).toHaveLength(1);
    expect(matchState(model.results, model.unitCount, model.weightOf).holesLeft).toBe(1);
  });

  it("counts a resolved-but-level game as PLAYED", () => {
    /**
     * A push, a cancellation and a game both got right are all RESOLVED — they
     * consume a unit and reduce what is left, even though nobody moved. A build
     * that skipped them would leave the match permanently unfinishable.
     */
    const model = pickemCardModel(slate(["g1", 1]), [
      row({ slateGameId: "g1", result: "push", swing: 0, zeroKind: "push" }),
    ]);
    expect(model.results).toEqual([{ hole: 1, result: "H" }]);
    expect(matchState(model.results, 1, model.weightOf).over).toBe(true);
  });
});

describe("the multiplier is the weight, and it is per game", () => {
  it("weights whichever game carries it, including the first", () => {
    /**
     * Golf's mechanic can only double a TRAILING window. This is the case that
     * proves the selector moved: the multiplier is on game 1 of 3.
     */
    const model = pickemCardModel(slate(["g1", 3], ["g2", 1], ["g3", 1]), [
      row({ slateGameId: "g1", result: "home", swing: 3 }),
    ]);
    expect(model.weightOf(1)).toBe(3);
    expect(model.weightOf(2)).toBe(1);
    expect(matchState(model.results, 3, model.weightOf).up).toBe(3);
  });

  it("reads a missing multiplier as 1, NEVER as 0", () => {
    /**
     * A `?? 0` would silently delete the game from the match — it would score
     * nothing and contribute nothing to the remaining swing, so a match could
     * close early on a game that was still live. The column is nullable and
     * this is its second reader.
     */
    const model = pickemCardModel([{ id: "g1" }, { id: "g2", multiplier: null }], []);
    expect(model.weightOf(1)).toBe(1);
    expect(model.weightOf(2)).toBe(1);
  });

  it("marks weighted units for the bar without re-deriving the rule", () => {
    const model = pickemCardModel(slate(["g1", 2], ["g2", 1]), []);
    const weighted = pickemWeightedUnit(model);
    expect(weighted(1)).toBe(true);
    expect(weighted(2)).toBe(false);
  });
});

describe("three shapes — and the two absences are not the halve", () => {
  const built = () =>
    pickemCardModel(slate(["g1", 1], ["g2", 1], ["g3", 1], ["g4", 1], ["g5", 1]), [
      row({ slateGameId: "g1", result: "home", swing: 0, zeroKind: "both" }),
      row({ slateGameId: "g2", result: "home", swing: 0, zeroKind: "neither" }),
      row({ slateGameId: "g3", result: "push", swing: 0, zeroKind: "push" }),
      row({ slateGameId: "g4", result: "cancelled", swing: 0, zeroKind: "cancelled" }),
      row({ slateGameId: "g5", result: "home", swing: 0, zeroKind: "unpicked" }),
    ]);

  it("leaves the three CONTESTED draws unmarked — they are the ordinary grey", () => {
    /**
     * Both right, both wrong, and a push are all "played, contested, nobody
     * moved" — which is exactly golf's halve, and the segment that already
     * means it.
     */
    const { decidedStake } = built();
    expect(decidedStake[1]).toBeUndefined();
    expect(decidedStake[2]).toBeUndefined();
    expect(decidedStake[3]).toBeUndefined();
  });

  it("marks cancelled and unpicked, and marks them DIFFERENTLY", () => {
    /**
     * THE MUTATION: give both the same mark, or fold them into the halve.
     *
     * Grey would claim a contest that did not happen — a cancelled game had its
     * stake struck and an unpicked one never had a stake at all. And they must
     * not match each other either: one means "something was here", the other
     * "nothing ever was". A build that used one value for both passes any test
     * asserting only that they are marked.
     */
    const { decidedStake } = built();
    expect(decidedStake[4]).toBe("void");
    expect(decidedStake[5]).toBe("none");
    expect(decidedStake[4]).not.toBe(decidedStake[5]);
  });

  it("still counts all five as played", () => {
    // Being unmarked, void or none changes how a unit DRAWS, never whether it
    // resolved.
    expect(built().results).toHaveLength(5);
  });
});

describe("the magnitude is the ENGINE's job, not the adapter's", () => {
  it("keeps only the SIGN of swing, so the weight is applied once", () => {
    /**
     * `swing` already carries the points this game moved the match. Passing it
     * through would weight the game twice — once in the board's own maths and
     * again in `matchState` via `weightOf`.
     *
     * The proof: a 3× game whose row reports a swing of 3 must score 3, not 9.
     * A build that trusted the magnitude reads 9 here and is a second scoring
     * implementation.
     *
     * THE SLATE IS THREE LONG ON PURPOSE. At a slate of one, `matchState` hits
     * `holesLeftRaw === 0` and BREAKS after the first entry — so a mutant that
     * emits the game three times is short-circuited and the test passes for a
     * reason that has nothing to do with the claim. Found by the mutation
     * surviving: the fixture was too small for it to reach the code, which is a
     * fact about the fixture before it is one about the test.
     */
    const model = pickemCardModel(slate(["g1", 3], ["g2", 1], ["g3", 1]), [
      row({ slateGameId: "g1", result: "home", swing: 3 }),
    ]);
    expect(model.results).toHaveLength(1);
    expect(matchState(model.results, model.unitCount, model.weightOf).up).toBe(3);
  });
});
