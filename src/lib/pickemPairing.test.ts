import { describe, it, expect } from "vitest";
import {
  isValidPair,
  validPairCount,
  matchesComplete,
  pairedMembers,
  assignToSlot,
  randomizePairs,
  emptyPairs,
  pairsToPayload,
  type PickemPair,
} from "./pickemPairing";

/** Deterministic "shuffle": reverse. Enough to prove the input was permuted
 *  without stubbing global randomness. */
const rev = <T,>(xs: T[]): T[] => [...xs].reverse();

const pair = (a: string | null, b: string | null): PickemPair => ({ a, b });

describe("what counts as a match", () => {
  it("BOTH slots filled, and nothing else", () => {
    expect(isValidPair(pair("x", "y"))).toBe(true);
    expect(isValidPair(pair("x", null))).toBe(false);
    expect(isValidPair(pair(null, "y"))).toBe(false);
    expect(isValidPair(pair(null, null))).toBe(false);
  });

  it("agrees with the DIVISOR's definition, which is the point of one predicate", () => {
    // `liveMatchPointsPerMatch` filters `sideAId != null && sideBId != null`.
    // If these two ever disagree, the grid shows a count the points do not use.
    const pairs = [pair("a", "b"), pair("c", null), pair("d", "e")];
    const asDivisorSeesIt = pairs
      .map((p) => ({ sideAId: p.a, sideBId: p.b, pointValue: null }))
      .filter((m) => m.sideAId != null && m.sideBId != null).length;
    expect(validPairCount(pairs)).toBe(asDivisorSeesIt);
    expect(validPairCount(pairs)).toBe(2);
  });
});

describe("matchesComplete — §7's gate as a predicate, not an action", () => {
  it("true only when every row is filled", () => {
    expect(matchesComplete([pair("a", "b"), pair("c", "d")])).toBe(true);
    expect(matchesComplete([pair("a", "b"), pair("c", null)])).toBe(false);
  });

  it("an EMPTY set is NOT complete", () => {
    // "No matches yet" and "matches, all paired" are the two states §5 renders
    // differently — coming-soon versus the grid. Collapsing them would show an
    // empty grid as finished, and let Phase 5 accept results for nobody.
    expect(matchesComplete([])).toBe(false);
  });
});

describe("assignToSlot", () => {
  it("places someone in the slot", () => {
    const out = assignToSlot(emptyPairs(2, 2), 0, "a", "zach");
    expect(out[0]).toEqual(pair("zach", null));
  });

  it("EVICTS them from anywhere else — one sheet, one match", () => {
    // Without this, tapping a name into a second slot duplicates them and the
    // divisor counts a match whose result is already spoken for.
    const start = [pair("zach", "brad"), pair(null, null)];
    const out = assignToSlot(start, 1, "a", "zach");
    expect(out[0]).toEqual(pair(null, "brad"));
    expect(out[1]).toEqual(pair("zach", null));
    expect(pairedMembers(out)).toEqual(new Set(["zach", "brad"]));
  });

  it("evicts across SIDES too, not just within one", () => {
    // Someone dragged from the B column to the A column must leave B.
    const start = [pair(null, "zach"), pair(null, null)];
    const out = assignToSlot(start, 1, "a", "zach");
    expect(out[0]).toEqual(pair(null, null));
    expect(out[1]).toEqual(pair("zach", null));
  });

  it("clearing a slot removes nobody else", () => {
    const start = [pair("zach", "brad"), pair("rob", "ty")];
    const out = assignToSlot(start, 0, "a", null);
    expect(out[0]).toEqual(pair(null, "brad"));
    expect(out[1]).toEqual(pair("rob", "ty"));
  });
});

describe("randomizePairs — §8.3", () => {
  it("pairs everyone when the sides are EVEN", () => {
    const out = randomizePairs(["a1", "a2"], ["b1", "b2"], rev);
    expect(out).toHaveLength(2);
    expect(out.every(isValidPair)).toBe(true);
  });

  it("actually permutes rather than pairing in roster order", () => {
    // A "randomize" that returned the input order would pass every count-based
    // assertion above while doing nothing.
    const out = randomizePairs(["a1", "a2", "a3"], ["b1", "b2", "b3"], rev);
    expect(out.map((p) => p.a)).toEqual(["a3", "a2", "a1"]);
  });

  it("LEAVES THE REMAINDER UNPAIRED — it does not choose who sits out", () => {
    // The §10 test that must fail against a build that pairs only even fields
    // or silently drops the surplus. Sitting someone out is a social decision;
    // an algorithm making it would render the choice invisible.
    const out = randomizePairs(["a1", "a2", "a3"], ["b1", "b2"], rev);
    expect(out).toHaveLength(3);
    expect(validPairCount(out)).toBe(2);
    const unpaired = out.filter((p) => !isValidPair(p));
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0].b).toBeNull();
    // Nobody was dropped: all three from side A still have a row.
    expect(out.map((p) => p.a).filter(Boolean).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("gives each surplus person their OWN dashed row", () => {
    // Collapsing them into one "not playing" line would hide WHICH of them is
    // out, which is the thing the runner is looking at the grid to decide.
    const out = randomizePairs(["a1", "a2", "a3", "a4"], ["b1"], rev);
    expect(out).toHaveLength(4);
    expect(validPairCount(out)).toBe(1);
    expect(out.filter((p) => !isValidPair(p))).toHaveLength(3);
  });

  it("handles a side being empty without throwing", () => {
    const out = randomizePairs(["a1", "a2"], [], rev);
    expect(out).toHaveLength(2);
    expect(validPairCount(out)).toBe(0);
  });
});

describe("manual and randomize produce the same SHAPE — §10", () => {
  it("both give one row per person on the larger side", () => {
    // So switching between the two methods does not reflow the grid.
    expect(emptyPairs(3, 2)).toHaveLength(3);
    expect(randomizePairs(["a1", "a2", "a3"], ["b1", "b2"], rev)).toHaveLength(3);
    expect(emptyPairs(2, 5)).toHaveLength(5);
    expect(randomizePairs(["a1", "a2"], ["b1", "b2", "b3", "b4", "b5"], rev)).toHaveLength(5);
  });
});

describe("pairsToPayload", () => {
  it("drops rows nobody is in", () => {
    // An empty row is UI scaffolding, not a match. Persisting it would leave a
    // permanently-invalid row in `game_matches` for the divisor to skip forever.
    const out = pairsToPayload([pair("a", "b"), pair(null, null), pair("c", null)]);
    expect(out).toEqual([
      { a: "a", b: "b" },
      { a: "c", b: null },
    ]);
  });

  it("KEEPS a half-filled row — someone sitting out is a real state", () => {
    // The runner may commit with an unpaired person on purpose (§4). Dropping
    // half-filled rows would silently erase that decision on save and the grid
    // would come back different from what they committed.
    expect(pairsToPayload([pair("a", null)])).toEqual([{ a: "a", b: null }]);
  });
});
