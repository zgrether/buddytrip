import { describe, it, expect } from "vitest";
import {
  bracketSize,
  roundCount,
  seedOrder,
  buildDraw,
  isBye,
  firstOpponent,
  type BracketDrawMatch,
} from "./bracket";

/**
 * The pure draw builder. Everything here is a property of the TREE — no game, no
 * database, no results — which is the point of keeping it client-safe: the setup
 * preview and the persisted draw run this same function.
 */

const round1 = (m: BracketDrawMatch[]) => m.filter((x) => x.round === 1 && x.bracket === "main");
const pairs = (m: BracketDrawMatch[]) => round1(m).map((x) => [x.aSeed, x.bSeed]);

describe("bracketSize / roundCount", () => {
  it("rounds up to the next power of two — the gap IS the byes", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(8)).toBe(8);
    expect(bracketSize(9)).toBe(16);
  });

  it("a field too small to play has no draw", () => {
    expect(bracketSize(0)).toBe(0);
    expect(bracketSize(1)).toBe(0);
    expect(roundCount(1)).toBe(0);
    expect(buildDraw(1)).toEqual([]);
  });

  it("rounds are log2 of the seat count", () => {
    expect(roundCount(2)).toBe(1);
    expect(roundCount(4)).toBe(2);
    expect(roundCount(5)).toBe(3);
    expect(roundCount(16)).toBe(4);
  });
});

describe("seedOrder — the standard bracket order", () => {
  it("matches the textbook orders", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("every seat is filled exactly once", () => {
    const order = seedOrder(16);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("each pairing sums to size + 1 — 1 plays last, 2 plays second-last", () => {
    const size = 16;
    const order = seedOrder(size);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i] + order[i + 1]).toBe(size + 1);
    }
  });

  it("the better seed is always FIRST in a pairing (what the bye seat relies on)", () => {
    const order = seedOrder(16);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]).toBeLessThan(order[i + 1]);
    }
  });

  it("the top two seeds can only meet in the final", () => {
    // Seeds 1 and 2 sit in opposite halves at every size, so no earlier round
    // can pair them.
    for (const size of [4, 8, 16, 32]) {
      const order = seedOrder(size);
      expect(order.indexOf(1)).toBeLessThan(size / 2);
      expect(order.indexOf(2)).toBeGreaterThanOrEqual(size / 2);
    }
  });
});

describe("buildDraw — round 1 is seeded, later rounds are shape only", () => {
  it("a full field of 8 pairs 1v8, 4v5, 2v7, 3v6 and has no byes", () => {
    const draw = buildDraw(8);
    expect(pairs(draw)).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    expect(draw.filter(isBye)).toEqual([]);
  });

  it("later rounds carry no seeds — occupants are derived from the winners below", () => {
    const draw = buildDraw(8);
    for (const m of draw.filter((x) => x.round > 1)) {
      expect(m.aSeed).toBeNull();
      expect(m.bSeed).toBeNull();
    }
  });

  it("slot counts halve each round", () => {
    const draw = buildDraw(16);
    const perRound = [1, 2, 3, 4].map((r) => draw.filter((m) => m.bracket === "main" && m.round === r).length);
    expect(perRound).toEqual([8, 4, 2, 1]);
  });

  it("slots are 1-based and contiguous within every round", () => {
    const draw = buildDraw(16, { consolation: true });
    for (const round of [1, 2, 3, 4]) {
      const slots = draw.filter((m) => m.bracket === "main" && m.round === round).map((m) => m.slot);
      expect(slots).toEqual(Array.from({ length: slots.length }, (_, i) => i + 1));
    }
  });

  it("(bracket, round, slot) is unique — the DB's total order holds", () => {
    const draw = buildDraw(16, { consolation: true });
    const keys = draw.map((m) => `${m.bracket}:${m.round}:${m.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildDraw — byes", () => {
  it("5 entrants in an 8-seat draw gives exactly 3 byes, all to the top seeds", () => {
    const draw = buildDraw(5);
    const byes = draw.filter(isBye);
    expect(byes).toHaveLength(3);
    // Seats 6, 7 and 8 are empty, so seeds 3, 2 and 1 advance unopposed.
    expect(byes.map((m) => m.aSeed).sort((a, b) => a! - b!)).toEqual([1, 2, 3]);
  });

  it("the bye count is exactly the number of empty seats", () => {
    for (const n of [3, 5, 6, 7, 9, 13]) {
      expect(buildDraw(n).filter(isBye)).toHaveLength(bracketSize(n) - n);
    }
  });

  it("a bye's opponent seat is null and its own seat is the better seed", () => {
    // The pairing order guarantees the surviving entrant is always seat A, so
    // nothing downstream has to handle "the bye is on side B".
    for (const n of [3, 5, 6, 7, 9, 13]) {
      for (const m of buildDraw(n).filter(isBye)) {
        expect(m.aSeed).not.toBeNull();
        expect(m.bSeed).toBeNull();
      }
    }
  });

  it("a bye is a round-1 concept — an empty later slot is not one", () => {
    const derived = buildDraw(8).find((m) => m.round === 2)!;
    expect(derived.aSeed).toBeNull();
    expect(derived.bSeed).toBeNull();
    expect(isBye(derived)).toBe(false);
  });

  it("every entrant appears exactly once in round 1", () => {
    for (const n of [2, 3, 5, 8, 13]) {
      const seen = round1(buildDraw(n)).flatMap((m) => [m.aSeed, m.bSeed]).filter((s): s is number => s !== null);
      expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});

describe("buildDraw — the consolation match", () => {
  it("adds one 3rd-place row alongside the final", () => {
    const draw = buildDraw(8, { consolation: true });
    const consolation = draw.filter((m) => m.bracket === "consolation");
    expect(consolation).toEqual([{ bracket: "consolation", round: 3, slot: 1, aSeed: null, bSeed: null }]);
  });

  it("is absent when the toggle is off — structurally missing, not hidden", () => {
    expect(buildDraw(8).filter((m) => m.bracket === "consolation")).toEqual([]);
  });

  it("is refused for a two-entrant draw, which has no semi-final to lose", () => {
    // One match means the "losers" are a single person; a 3rd/4th line there
    // would describe a place the field does not have.
    expect(buildDraw(2, { consolation: true }).filter((m) => m.bracket === "consolation")).toEqual([]);
    expect(buildDraw(3, { consolation: true }).filter((m) => m.bracket === "consolation")).toHaveLength(1);
  });
});

describe("buildDraw — determinism", () => {
  it("is a function of the entrant count alone", () => {
    expect(buildDraw(11, { consolation: true })).toEqual(buildDraw(11, { consolation: true }));
  });
});

/**
 * The seed list's "you play N first" must agree with the tree that gets BUILT.
 *
 * `firstOpponent` is what the seeding UI shows while someone drags rows around,
 * and `buildDraw` is what `save_game_config` persists. They are two readings of
 * one fact, so this pins them together rather than trusting that both implement
 * "1 plays last" the same way — the exact class of drift CLAUDE.md #8 exists to
 * prevent.
 */
describe("firstOpponent agrees with buildDraw's round 1", () => {
  /** Round-1 pairings as the built draw states them, 0-based, both directions. */
  function pairingsFromDraw(count: number): Map<number, number | null> {
    const out = new Map<number, number | null>();
    for (const m of buildDraw(count).filter((x) => x.round === 1)) {
      // A null opponent is a bye; seeds are 1-based in the draw, 0-based here.
      if (m.aSeed !== null) out.set(m.aSeed - 1, m.bSeed === null ? null : m.bSeed - 1);
      if (m.bSeed !== null) out.set(m.bSeed - 1, m.aSeed === null ? null : m.aSeed - 1);
    }
    return out;
  }

  for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 17, 32]) {
    it(`matches the built draw for ${count} entrants`, () => {
      const fromDraw = pairingsFromDraw(count);
      for (let i = 0; i < count; i++) {
        expect(firstOpponent(i, count)).toBe(fromDraw.get(i) ?? null);
      }
    });
  }

  it("seed 1 plays the last seed and seed 2 the second-last, in a full field", () => {
    expect(firstOpponent(0, 16)).toBe(15); // 1 v 16
    expect(firstOpponent(1, 16)).toBe(14); // 2 v 15
    expect(firstOpponent(2, 16)).toBe(13); // 3 v 14
  });

  it("the top seeds draw the byes when the field isn't a power of two", () => {
    // 6 entrants in an 8-seat draw: seeds 7 and 8 don't exist, so 1 and 2 sit out.
    expect(firstOpponent(0, 6)).toBeNull();
    expect(firstOpponent(1, 6)).toBeNull();
    expect(firstOpponent(2, 6)).toBe(5); // 3 v 6
  });

  it("a field too small to play has no opponents at all", () => {
    expect(firstOpponent(0, 1)).toBeNull();
  });
});
