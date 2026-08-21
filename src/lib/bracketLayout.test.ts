import { describe, it, expect } from "vitest";
import { buildDoubleDraw } from "./bracketDouble";
import {
  roundLayout,
  cardCentre,
  BRACKET_METRICS,
  SLOT_HEIGHT,
  MATCH_HEADER_HEIGHT,
  lowerTierCentres,
  lowerColumnFromRight,
  lowerColumnsDoNotOverlap,
  type BracketMetrics,
} from "./bracketLayout";
import { bracketSize, roundCount, buildDraw } from "./bracket";

/**
 * The one property the bracket's geometry has to have:
 *
 *   **a match centres on the separator between the two matches feeding it.**
 *
 * Asserted as a relationship between computed centres, at every field size the
 * app can produce — which is the part a CSS-only layout could not give us. The
 * board this replaced distributed each column evenly and *looked* right at some
 * sizes, because even distribution coincides with the correct answer when every
 * column and card is the same height. It stopped coinciding the moment a round
 * heading joined the distribution or a bye row rendered shorter.
 */

const M: BracketMetrics = BRACKET_METRICS;

describe("BRACKET_METRICS", () => {
  it("cardHeight is the sum of the parts the markup actually renders", () => {
    // Two competitor rows + the match-number header + the card's own 1px
    // borders. If a row grows and this is not updated, every round below the
    // first drifts — so the arithmetic is asserted rather than trusted.
    expect(M.cardHeight).toBe(MATCH_HEADER_HEIGHT + SLOT_HEIGHT * 2 + 2);
  });
});

describe("roundLayout", () => {
  it("round 1 is the ground truth — no offset, the base gap", () => {
    expect(roundLayout(1, M)).toEqual({ offset: 0, gap: M.baseGap, span: M.cardHeight + M.baseGap });
  });

  it("each round doubles the span", () => {
    expect(roundLayout(2, M).span).toBe(2 * roundLayout(1, M).span);
    expect(roundLayout(3, M).span).toBe(4 * roundLayout(1, M).span);
    expect(roundLayout(4, M).span).toBe(8 * roundLayout(1, M).span);
  });

  it("each round starts half a span further down than the one below", () => {
    const unit = M.cardHeight + M.baseGap;
    expect(roundLayout(2, M).offset).toBe(unit / 2);
    expect(roundLayout(3, M).offset).toBe(unit * 1.5);
  });
});

describe("a match centres on its feeding pair, at every size 4→16", () => {
  // Every field size the board can render, not just the powers of two — a
  // 5-entrant draw is an 8-seat tree with byes, and its geometry is the tree's.
  for (let entrants = 4; entrants <= 16; entrants++) {
    it(`${entrants} entrants (${bracketSize(entrants)}-seat draw, ${roundCount(entrants)} rounds)`, () => {
      const rounds = roundCount(entrants);
      const size = bracketSize(entrants);

      for (let round = 2; round <= rounds; round++) {
        const slotsInRound = size / 2 ** round;
        for (let j = 0; j < slotsInRound; j++) {
          // `parentOf`'s relationship, as indices: cards 2j and 2j+1 of the round
          // below feed card j of this one.
          const feederA = cardCentre(round - 1, 2 * j, M);
          const feederB = cardCentre(round - 1, 2 * j + 1, M);
          expect(cardCentre(round, j, M)).toBeCloseTo((feederA + feederB) / 2, 10);
        }
      }
    });
  }
});

describe("the geometry matches the draw the app actually builds", () => {
  it("every match in every built draw has a centre, and the final is centred on the whole tree", () => {
    for (let entrants = 4; entrants <= 16; entrants++) {
      const draw = buildDraw(entrants).filter((m) => m.bracket === "main");
      const rounds = roundCount(entrants);
      const finalCentre = cardCentre(rounds, 0, M);

      // The final sits at the midpoint of the first round's full extent — the
      // visual claim "the tree converges on one match".
      const firstRound = draw.filter((m) => m.round === 1);
      const top = cardCentre(1, 0, M);
      const bottom = cardCentre(1, firstRound.length - 1, M);
      expect(finalCentre).toBeCloseTo((top + bottom) / 2, 10);
    }
  });
});

describe("lowerTierCentres — the lower tier centres on its SAME-TIER feeders", () => {
  const M = BRACKET_METRICS;
  const unit = M.cardHeight + M.baseGap;
  const k = (r: number, s: number) => `${r}:${s}`;

  /** The 8-entrant lower bracket: 2 + 2 + 1 + 1. */
  const full = [
    { round: 1, slot: 1 }, { round: 1, slot: 2 },
    { round: 2, slot: 1 }, { round: 2, slot: 2 },
    { round: 3, slot: 1 },
    { round: 4, slot: 1 },
  ];

  it("lays round 1 out uniformly — it is the tier's ground truth", () => {
    const c = lowerTierCentres(full, M);
    expect(c.get(k(1, 1))).toBe(M.cardHeight / 2);
    expect(c.get(k(1, 2))! - c.get(k(1, 1))!).toBe(unit * 2); // two slots: each match has its major beneath it
  });

  it("OFFSETS a one-feeder match from its feeder, never level with it", () => {
    // Match 10 takes `Winner of 8` and `Loser of 6`. Only the first constrains it —
    // satisfying both would drag the tier toward the upper rows. But centring ON it put
    // 10 at 8's row, which reads as inline rather than as an arm, and leaves no room for
    // the upper arm arriving from above.
    const c = lowerTierCentres(full, M);
    expect(c.get(k(2, 1))).not.toBe(c.get(k(1, 1)));
    expect(c.get(k(2, 1))! - c.get(k(1, 1))!).toBe(unit);
    expect(c.get(k(2, 2))! - c.get(k(1, 2))!).toBe(unit);
  });

  it("centres a MINOR round BETWEEN its two feeders — the reported bug", () => {
    // Match 12 takes Winner of 10 and Winner of 11, and sat level with 10.
    const c = lowerTierCentres(full, M);
    const mid = (c.get(k(2, 1))! + c.get(k(2, 2))!) / 2;
    expect(c.get(k(3, 1))).toBe(mid);
    expect(c.get(k(3, 1))).not.toBe(c.get(k(2, 1)));
  });

  it("offsets the Lower Final from the round below it", () => {
    // Match 13 takes Winner of 12 and Loser of 7 — constrained by 12 alone, but sitting
    // ON 12 is what made it read as inline.
    const c = lowerTierCentres(full, M);
    expect(c.get(k(4, 1))).not.toBe(c.get(k(3, 1)));
  });

  it("converges inward moving right, the way the upper tier does", () => {
    const c = lowerTierCentres(full, M);
    const spread = (r: number) => {
      const cs = full.filter((m) => m.round === r).map((m) => c.get(k(r, m.slot))!);
      return Math.max(...cs) - Math.min(...cs);
    };
    expect(spread(3)).toBeLessThan(spread(2));
  });

  it("THE DEGENERATE CASE: an unanchored match inherits spacing, never zero", () => {
    // 5 entrants: match 9 (round 1, slot 2) is all-bye and is not rendered, so round 2
    // slot 2 has no same-tier anchor at all. A naive implementation returns 0 here and
    // stacks it on top of its sibling.
    const sparse = full.filter((m) => !(m.round === 1 && m.slot === 2));
    const c = lowerTierCentres(sparse, M);
    const a = c.get(k(2, 1))!;
    const b = c.get(k(2, 2))!;
    expect(b).not.toBe(0);
    expect(b).not.toBe(a);          // never overlapping
    expect(b - a).toBe(unit * 2);   // inherited the round's spacing
  });

  it("distributes evenly when a round has no anchors at all", () => {
    const orphaned = [{ round: 2, slot: 1 }, { round: 2, slot: 2 }];
    const c = lowerTierCentres(orphaned, M);
    // Round 2 is the first round PRESENT, so it is treated as the tier's ground truth.
    expect(c.get(k(2, 1))).toBe(M.cardHeight / 2);
    expect(c.get(k(2, 2))! - c.get(k(2, 1))!).toBe(unit * 2);
  });

  it("returns a centre for every match it was given", () => {
    for (const set of [full, full.filter((m) => m.round !== 1)]) {
      const c = lowerTierCentres(set, M);
      expect(c.size).toBe(set.length);
      for (const v of c.values()) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("the invariant: no match sits level with a match it consumes", () => {
  /**
   * General, and checkable at every entrant count — which is the point. This is the
   * check that would have caught matches 12 and 13 reading as inline without anyone
   * looking at a screenshot, and it keeps holding for entrant counts nobody has staged.
   *
   * Same-tier consumption only: an upper dropper feeds a lower match too, but the tiers
   * have independent geometry and are deliberately not aligned to each other.
   */
  const sameTierFeeders = (round: number, slot: number) =>
    round % 2 === 1
      ? [{ round: round - 1, slot: slot * 2 - 1 }, { round: round - 1, slot: slot * 2 }]
      : [{ round: round - 1, slot }];

  it.each([3, 4, 5, 6, 7, 8, 9, 16, 32, 64])("holds at %i entrants", (n) => {
    const lower = buildDoubleDraw(n).filter((m) => m.bracket === "lower");
    if (lower.length === 0) return;
    const c = lowerTierCentres(lower, BRACKET_METRICS);
    const rounds = [...new Set(lower.map((m) => m.round))].sort((a, b) => a - b);

    for (const m of lower) {
      if (m.round === rounds[0]) continue;
      const mine = c.get(`${m.round}:${m.slot}`);
      expect(mine, `${m.round}:${m.slot} at ${n} has no centre`).toBeDefined();
      for (const f of sameTierFeeders(m.round, m.slot)) {
        const theirs = c.get(`${f.round}:${f.slot}`);
        if (theirs === undefined) continue;      // absent feeder: the fallback's job
        expect(
          mine,
          `match ${m.round}:${m.slot} sits level with its feeder ${f.round}:${f.slot} at ${n} entrants`,
        ).not.toBe(theirs);
      }
    }
  });

  it.each([16, 32, 64])("returns a finite centre for every match at %i", (n) => {
    const lower = buildDoubleDraw(n).filter((m) => m.bracket === "lower");
    const c = lowerTierCentres(lower, BRACKET_METRICS);
    expect(c.size).toBe(lower.length);
    for (const v of c.values()) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("shared columns: a major sits in its minor feeder's column", () => {
  it.each([8, 16, 32, 64])("makes the lower tier narrower than the upper bracket at %i", (n) => {
    // The span fix, as arithmetic. The tier was (W-2) columns wider than the upper
    // bracket and reached left of it; pairing each major with its minor makes it W-1.
    const lower = buildDoubleDraw(n).filter((m) => m.bracket === "lower");
    const total = new Set(lower.map((m) => m.round)).size;
    const cols = new Set(lower.map((m) => lowerColumnFromRight(m.round, total)));
    const upperRounds = Math.log2(2 ** Math.ceil(Math.log2(n)));
    expect(cols.size, `lower columns at ${n}`).toBe(upperRounds - 1);
    expect(cols.size).toBeLessThan(upperRounds);
  });

  it.each([3, 4, 5, 6, 7, 8, 9, 16, 32, 64])("never overlaps two cards in one column at %i", (n) => {
    // The failure mode the change introduces, and the reason a one-feeder consumer now
    // sits a FULL slot below its feeder rather than half: at half a slot two cards in
    // one column would overlap, because a card is 88px and a slot is 100px.
    const lower = buildDoubleDraw(n).filter((m) => m.bracket === "lower");
    if (lower.length === 0) return;
    const bad = lowerColumnsDoNotOverlap(lower, BRACKET_METRICS);
    expect(bad, `overlapping cards at ${n}: ${JSON.stringify(bad)}`).toEqual([]);
  });
});
