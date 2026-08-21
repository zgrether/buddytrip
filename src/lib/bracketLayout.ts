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

/**
 * Vertical centres for the LOWER tier — the same rule the upper bracket uses, applied
 * to a tier whose feeders are not the pair directly below it.
 *
 * ── Only SAME-TIER feeders constrain vertical position ──────────────────────
 * A major round's match takes a lower survivor AND an upper dropper — match 10 is
 * `Winner of 8` + `Loser of 6` — and only the first constrains it. Satisfying both
 * would drag lower matches toward upper rows and reintroduce exactly the coupling the
 * right-to-left column rule removed.
 *
 * ── A CONSUMER MAY NOT SIT LEVEL WITH ITS FEEDER ────────────────────────────
 * The correction. Keyed on how many same-tier feeders a match has, which is what the
 * rule is actually about — not on round parity, which only correlates with it:
 *
 *   TWO feeders   centred between them. Already correct, unchanged.
 *   ONE feeder    OFFSET from it, never level. Centring on a single feeder puts the
 *                 consumer on that feeder's row, which is what made matches 12 and 13
 *                 read as inline rather than as an arm.
 *   NO feeder     the inherited-spacing fallback below.
 *
 * The offset is DOWNWARD by a FULL slot. Downward because the other arm arrives from
 * the upper tier above, so dropping the consumer leaves the room that arm needs.
 *
 * A full slot rather than half because a major now SHARES ITS MINOR FEEDER'S COLUMN —
 * the fix for the lower tier reaching left of the upper bracket. Two cards in one
 * column at half a slot apart would overlap: cards are 88px and a slot is 100px. The
 * spacing and the column model are one decision, not two.
 *
 * Which is also why the tier's first round steps by TWO slots: each of its matches has
 * a major sitting directly beneath it in the same column, and that major needs a slot
 * of its own.
 *
 * ── The degenerate case, which is the one that breaks ───────────────────────
 * A feeder can be ABSENT — at 5 entrants match 9 is all-bye — leaving a match with no
 * same-tier anchor at all. That is precisely where a naive implementation divides by
 * zero or silently returns 0 and stacks two cards on top of each other, and the odd
 * counts are already where this geometry breaks.
 *
 * So an unanchored match INHERITS its round's spacing: placed one span from the nearest
 * anchored sibling, the span measured from the anchored siblings themselves and falling
 * back to the base unit when there is only one. A round with no anchors at all
 * distributes evenly. Never zero, never overlapping.
 */
export function lowerTierCentres(
  matches: readonly { round: number; slot: number }[],
  metrics: BracketMetrics
): Map<string, number> {
  const unit = metrics.cardHeight + metrics.baseGap;
  /** How far a single-feeder consumer sits below its feeder — a full slot, because it
   *  shares the feeder's column and must not overlap it. */
  const armOffset = unit;
  /** The first round steps by two slots, leaving room for each match's major beneath it. */
  const baseStep = unit * 2;
  const centres = new Map<string, number>();
  const key = (round: number, slot: number) => `${round}:${slot}`;
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);

  for (const round of rounds) {
    const slots = matches.filter((m) => m.round === round).map((m) => m.slot).sort((a, b) => a - b);

    const anchored: (number | null)[] = slots.map((slot) => {
      if (round === rounds[0]) return null;                      // the tier's first round
      // Every same-tier feeder this match could have. A minor round takes two slots from
      // the round below; a major round takes the one at its own slot.
      const candidates = round % 2 === 1
        ? [centres.get(key(round - 1, slot * 2 - 1)), centres.get(key(round - 1, slot * 2))]
        : [centres.get(key(round - 1, slot))];
      const found = candidates.filter((c): c is number => c !== undefined);
      if (found.length === 2) return (found[0] + found[1]) / 2;  // centred between
      if (found.length === 1) return found[0] + armOffset;       // offset, never level
      return null;                                               // fallback below
    });

    const known = anchored.map((c, i) => ({ c, i })).filter((x): x is { c: number; i: number } => x.c !== null);
    const span = known.length >= 2
      ? (known[known.length - 1].c - known[0].c) / (known[known.length - 1].i - known[0].i)
      : baseStep;

    slots.forEach((slot, i) => {
      let centre = anchored[i];
      if (centre === null) {
        if (known.length === 0) {
          centre = i * baseStep + metrics.cardHeight / 2;
        } else {
          const near = known.reduce((best, x) => (Math.abs(x.i - i) < Math.abs(best.i - i) ? x : best), known[0]);
          centre = near.c + (i - near.i) * span;
        }
      }
      centres.set(key(round, slot), centre);
    });
  }

  return centres;
}

/**
 * Which column a lower round occupies, counted FROM THE RIGHT.
 *
 * A major round shares the column of the minor that feeds it, so the lower tier is
 * `rounds / 2` columns wide — always one narrower than the upper bracket, which is what
 * removes the overhang that made the tier reach left of it.
 *
 * Exported and shared with the board rather than restated there: the column rule and
 * the vertical rule have to agree about which matches land in one column, or two cards
 * end up in the same place. `lowerColumnsDoNotOverlap` below is the check that they do.
 */
export function lowerColumnFromRight(round: number, totalLowerRounds: number): number {
  return Math.ceil((totalLowerRounds - round + 1) / 2);
}

/**
 * Do any two matches sharing a column overlap vertically?
 *
 * The invariant the shared-column change introduces. "No match sits level with a match
 * it consumes" (T2) is about a consumer and its feeder; this is about ANY two cards that
 * now occupy one column — a different question, and one that only exists because majors
 * stopped getting a column of their own.
 *
 * Returns the offending pairs so a failure names them rather than just counting.
 */
export function lowerColumnsDoNotOverlap(
  matches: readonly { round: number; slot: number }[],
  metrics: BracketMetrics
): { a: string; b: string; gap: number }[] {
  const centres = lowerTierCentres(matches, metrics);
  const total = new Set(matches.map((m) => m.round)).size;
  const byColumn = new Map<number, { key: string; centre: number }[]>();
  for (const m of matches) {
    const col = lowerColumnFromRight(m.round, total);
    const centre = centres.get(`${m.round}:${m.slot}`);
    if (centre === undefined) continue;
    byColumn.set(col, [...(byColumn.get(col) ?? []), { key: `${m.round}:${m.slot}`, centre }]);
  }
  const bad: { a: string; b: string; gap: number }[] = [];
  for (const cards of byColumn.values()) {
    const sorted = [...cards].sort((x, y) => x.centre - y.centre);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].centre - sorted[i - 1].centre;
      if (gap < metrics.cardHeight) bad.push({ a: sorted[i - 1].key, b: sorted[i].key, gap });
    }
  }
  return bad;
}
