/**
 * Bracket GEOMETRY — where each match sits vertically in its round.
 *
 * Pure and client-safe (CLAUDE.md #8). This answers the one question the board's
 * markup cannot answer for itself: **a match in round R must centre on the gap
 * between the two matches that feed it.** That is what makes a bracket readable
 * as a tree rather than as four unrelated columns, and it is the whole of item 2.
 *
 * ── Why this is computed rather than left to `justify-around` ───────────────
 * Evenly distributing each column is *mathematically* the same thing when every
 * column has the same height and every card the same height — the fractions work
 * out (round 1 at 1/8, 3/8, 5/8, 7/8; round 2 at 1/4, 3/4, which are exactly the
 * midpoints). It is not robust in practice, for two reasons that both bit the
 * board it replaces:
 *
 *   1. The round HEADING was a flex child of the distributing column, so it was
 *      being spaced along with the matches. Round 1 distributed 5 items and
 *      round 2 distributed 3, which breaks the symmetry the fractions rely on.
 *   2. Card heights were not equal. A "Bye" row, a "waiting on the round below"
 *      row and a normal competitor row render different content, so a column of
 *      byes was shorter than a column of names and every round below it drifted.
 *
 * Both are the same failure: the layout depended on a coincidence rather than on
 * the tree. Computing the offsets makes the relationship explicit — and testable
 * at every field size, which a CSS coincidence is not.
 *
 * ── The recursion ───────────────────────────────────────────────────────────
 * Round R's matches sit `2^(R-1)` round-1 slots apart, and start half of that
 * span down. `parentOf` (bracketAdvance) already encodes which pair feeds which
 * match — slots `2j-1` and `2j` of round R feed slot `j` of round R+1 — so this
 * is the same relationship expressed as pixels instead of indices.
 */

/** One match card's fixed height, and the space between two cards in round 1.
 *  FIXED, not minimum: equal card heights are a precondition of the geometry
 *  below, and the previous board's `minHeight` let a bye row shrink. */
export interface BracketMetrics {
  cardHeight: number;
  baseGap: number;
}

/**
 * The board's actual numbers, in ONE place so the component and the geometry
 * cannot disagree.
 *
 * `cardHeight` is composed, not guessed: a 18px match-number header plus two
 * 34px competitor rows is 86, and the card's own 1px top and bottom borders make
 * 88 under `border-box`. Change a row's height and this must change with it —
 * that is the coupling, and it is why the number lives here rather than being
 * re-typed in the stylesheet.
 */
export const BRACKET_METRICS: BracketMetrics = { cardHeight: 88, baseGap: 12 };

/** The pieces `cardHeight` is made of, exported so the markup sets the same
 *  values it is measured by. */
export const SLOT_HEIGHT = 34;
export const MATCH_HEADER_HEIGHT = 18;

/**
 * One round column's width.
 *
 * Widened from 172 when competitor names went from 12px to the 15 rung
 * (STYLE_GUIDE §2a) — a bigger name in the same box just truncates sooner, which
 * would have traded one legibility problem for another. The board is no longer
 * inside the surface's readable column, so it can afford the width.
 */
export const BRACKET_COLUMN_WIDTH = 200;

export interface RoundLayout {
  /** Space above the round's FIRST card, so it centres on its feeding pair. */
  offset: number;
  /** Space between consecutive cards in this round. */
  gap: number;
  /** Distance between the tops of consecutive cards — `cardHeight + gap`. */
  span: number;
}

/**
 * Where round `round` (1-based) places its cards.
 *
 * Round 1 is the ground truth: offset 0, the base gap. Every later round doubles
 * the span and starts half a span further down, which is precisely "centre on
 * the separator between my two feeders".
 */
export function roundLayout(round: number, metrics: BracketMetrics): RoundLayout {
  const { cardHeight, baseGap } = metrics;
  const unit = cardHeight + baseGap;
  const span = unit * 2 ** (round - 1);
  return {
    span,
    // Half a span, less half a card — the distance from the top of the feeding
    // pair's bounding box to the top of a card centred on it.
    offset: (span - unit) / 2,
    gap: span - cardHeight,
  };
}

/** The vertical centre of card `index` (0-based) in `round`. The figure the
 *  alignment is actually about, and what the tests assert against. */
export function cardCentre(round: number, index: number, metrics: BracketMetrics): number {
  const { offset, span } = roundLayout(round, metrics);
  return offset + index * span + metrics.cardHeight / 2;
}
