/**
 * The bracket DRAW — pure, client-safe, no server/DB deps (CLAUDE.md #8).
 *
 * A bracket is a scheduler, not a scoring engine: given N entrants it produces
 * the tree of matches they play through. This module is the ONE place that tree
 * is computed, so the setup preview (client), the persisted draw
 * (`save_game_config`), and the bracket view all describe the same shape and
 * cannot diverge.
 *
 * ── Everything here is DERIVED, and that is the design ──────────────────────
 * The draw is a function of the entrant COUNT alone. It carries no results, no
 * winners and no advancement — `buildDraw(8)` is the same tree whether the game
 * has been played or not. Who is IN a later match is computed from the winners
 * below it (see migration 112's advancement note), which is why later rounds
 * leave both seats null here rather than being filled in as the game progresses.
 *
 * ── Seeds, not people ───────────────────────────────────────────────────────
 * This module speaks in SEEDS (1..N). Which person or pair holds a seed is a
 * separate question, answered by the seeding step in setup and stored on
 * `bracket_entrants`. Keeping the two apart is what lets a re-seed change who
 * plays whom without touching the tree's shape.
 */

/**
 * Which STRUCTURE a match belongs to — not who is in it (CLAUDE.md glossary,
 * ratified before migration 127 widened the matching CHECK).
 *
 *   main         the winners' bracket. Single elim is main alone.
 *   lower        the second-life bracket (double elim only). `lower`, never
 *                "losers": the value names a structure, not people.
 *   final        the grand final. Its own value rather than `main` round N+1,
 *                because advancement has NO link column — position IS the link
 *                (slot s -> ceil(s/2), seat by parity). As a main round the grand
 *                final would be the ONLY match whose entrants do not come from the
 *                round below it, forcing a special case into the one rule that has
 *                none. Round 2 of `final` is the if-necessary final.
 *   consolation  the single-elim 3rd-place play-off. Double elim produces 3rd
 *                structurally, so `consolation` and `lower` NEVER co-occur.
 */
export const BRACKET_SIDES = ["main", "lower", "final", "consolation"] as const;

/** Derived from `BRACKET_SIDES` so the type, the wire validators (`z.enum`) and the
 *  DB CHECK (migration 127) all trace to ONE list. Four sites repeated this union
 *  before double elim widened it, which is the shape CLAUDE.md #24 describes. */
export type BracketSide = (typeof BRACKET_SIDES)[number];

/** One match in the draw. Round 1 carries seeds; every later round derives its
 *  participants from the winners below, so both seats are null. */
export interface BracketDrawMatch {
  bracket: BracketSide;
  /** 1-based. Round 1 is the opening round; `roundCount()` is the final. */
  round: number;
  /** 1-based position within the round. Slot 1 of round R feeds from slots 1
   *  and 2 of round R-1. */
  slot: number;
  /** The better seed of a round-1 pairing, or null in a derived round. */
  aSeed: number | null;
  /** The weaker seed, or null — null in round 1 means a BYE (see `isBye`). */
  bSeed: number | null;
}

/** The next power of two at or above `entrantCount` — the number of round-1
 *  SEATS, which exceeds the entrant count exactly when there are byes. */
export function bracketSize(entrantCount: number): number {
  if (entrantCount < 2) return 0;
  let size = 1;
  while (size < entrantCount) size *= 2;
  return size;
}

/** How many rounds the main draw takes. 0 for a field too small to play. */
export function roundCount(entrantCount: number): number {
  const size = bracketSize(entrantCount);
  return size === 0 ? 0 : Math.log2(size);
}

/**
 * The standard bracket ORDER for a field of `size` seats — the seed sitting in
 * each round-1 seat, left to right.
 *
 * Built by the usual doubling recursion: a bracket of `size` is a bracket of
 * `size / 2` in which every seed `s` is replaced by the pair `s, size + 1 - s`.
 * That is what makes seeds 1 and 2 meet in the final rather than the first
 * round, and it is why each pair's first element is always the better seed —
 * a property `buildDraw` relies on when it decides which seat a bye lands in.
 *
 *   size 2 → [1, 2]
 *   size 4 → [1, 4, 2, 3]
 *   size 8 → [1, 8, 4, 5, 2, 7, 3, 6]
 */
export function seedOrder(size: number): number[] {
  if (size < 2) return [];
  let order = [1, 2];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((s) => [s, next + 1 - s]);
  }
  return order;
}

/**
 * Which seed the entrant at `index` (0-based, so seed `index + 1`) meets in
 * round 1 — returned 0-BASED, or null when they draw a bye.
 *
 * This is the standard pairing read off `seedOrder`'s recursion rather than
 * re-derived: seed `s` sits opposite `size + 1 - s`, which is 1v16, 2v15, 3v14…
 * A seat above the entrant count is nobody, so the answer is a bye — the same
 * rule `buildDraw` applies when it emits a null opponent.
 *
 * Lives HERE, beside the draw it describes, rather than in the seed-list
 * component that shows it (CLAUDE.md #8): the seeding UI and the built tree must
 * answer "who do I play first?" identically, and a second implementation in a
 * component is how the preview and the draw come to disagree. Pinned against
 * `buildDraw` in `bracket.test.ts`.
 */
export function firstOpponent(index: number, entrantCount: number): number | null {
  const size = bracketSize(entrantCount);
  if (size === 0) return null;
  const opponent = size - 1 - index;
  return opponent < entrantCount && opponent !== index ? opponent : null;
}

/**
 * True when this round-1 match has no opponent — the entrant advances without
 * playing.
 *
 * A bye is a null OPPONENT, not a match that was won: the row stores no winner
 * and no result, because nobody played (migration 112). Auto-advancing it as a
 * recorded win would invent a game that never happened and leave a pickable
 * result on screen for it.
 */
export function isBye(match: BracketDrawMatch): boolean {
  return match.round === 1 && match.aSeed !== null && match.bSeed === null;
}

/**
 * The full draw for `entrantCount` entrants.
 *
 * Round 1 is seeded from `seedOrder`; a seat holding a seed above the entrant
 * count is empty, which turns its pairing into a bye. Later rounds are emitted
 * as empty slots — the tree's SHAPE is fixed, its occupants are not.
 *
 * Returns `[]` below two entrants: there is no draw to play, and emitting a
 * one-slot round would render a bracket that cannot be advanced.
 */
export function buildDraw(
  entrantCount: number,
  opts: { consolation: boolean } = { consolation: false }
): BracketDrawMatch[] {
  const size = bracketSize(entrantCount);
  if (size === 0) return [];
  const rounds = roundCount(entrantCount);
  const order = seedOrder(size);
  const matches: BracketDrawMatch[] = [];

  // Round 1 — consecutive pairs of the seed order. A seat above the entrant
  // count is nobody, so its pairing carries a null opponent.
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i] <= entrantCount ? order[i] : null;
    const b = order[i + 1] <= entrantCount ? order[i + 1] : null;
    matches.push({ bracket: "main", round: 1, slot: i / 2 + 1, aSeed: a, bSeed: b });
  }

  // Rounds 2..final — shape only.
  for (let round = 2; round <= rounds; round++) {
    const slots = size / 2 ** round;
    for (let slot = 1; slot <= slots; slot++) {
      matches.push({ bracket: "main", round, slot, aSeed: null, bSeed: null });
    }
  }

  // The 3rd-place play-off, contested by the two losing semi-finalists. It sits
  // in the final's round because it is played alongside the final.
  //
  // Requires a semi-final to lose: a two-entrant draw is one match, and the
  // "losers" of a single round are one person. Emitting a consolation row there
  // would render a 3rd/4th line for a field that has no 3rd place.
  if (opts.consolation && rounds >= 2) {
    matches.push({ bracket: "consolation", round: rounds, slot: 1, aSeed: null, bSeed: null });
  }

  return matches;
}
