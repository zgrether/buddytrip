import { describe, it, expect } from "vitest";
import {
  roundLayout,
  cardCentre,
  BRACKET_METRICS,
  SLOT_HEIGHT,
  MATCH_HEADER_HEIGHT,
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
