/**
 * Pick'em's matches: who plays whom, across the two sides of a cup.
 *
 * Client-safe and pure (CLAUDE.md #8) — the grid, the save and (Phase 5) the
 * results gate all have to agree on what a match IS and when the set is
 * complete, and three implementations of that would agree today and drift.
 *
 * ── Cross-team, which is why the grid is new ───────────────────────────────
 *
 * Phase 0 found no cross-team pairing anywhere in the app. Match play pairs
 * within a game's own roster; brackets seed one pool. Pick'em pairs ONE PERSON
 * FROM EACH SIDE, so a match is a pair of slots drawn from two different lists
 * and "valid" means both are filled — the same definition
 * `liveMatchPointsPerMatch` already uses, deliberately, so the divisor and this
 * file cannot disagree about which matches count.
 */

export interface PickemPair {
  /** A user id from side A, or null for an empty slot. */
  a: string | null;
  /** A user id from side B, or null. */
  b: string | null;
}

/** Both slots filled. The ONE definition of a match that counts — for the
 *  divisor, for the completeness gate, and for the dashed row in the grid. */
export function isValidPair(p: PickemPair): boolean {
  return p.a != null && p.b != null;
}

export function validPairCount(pairs: PickemPair[]): number {
  return pairs.filter(isValidPair).length;
}

/**
 * §7's gate, as a PREDICATE rather than an action.
 *
 * "Matches are finalized" is not a step, a button, or a `matches_published_at`
 * column — it is a property of the data, and Phase 5 enforces it by asking.
 * True when there is at least one match and none of them is half-filled: a
 * result awarded to an incomplete match has nobody to award X/N to, and N is
 * undefined.
 *
 * An EMPTY set is not complete. That distinction matters because "no matches
 * yet" and "matches, all paired" are the two states §5 renders differently
 * (coming-soon vs the grid), and collapsing them would show an empty grid as
 * finished.
 */
export function matchesComplete(pairs: PickemPair[]): boolean {
  return pairs.length > 0 && pairs.every(isValidPair);
}

/** Everyone currently placed, either side. Used to keep a person from being
 *  paired twice — a sheet belongs to one match. */
export function pairedMembers(pairs: PickemPair[]): Set<string> {
  const out = new Set<string>();
  for (const p of pairs) {
    if (p.a) out.add(p.a);
    if (p.b) out.add(p.b);
  }
  return out;
}

/**
 * Put someone in a slot, removing them from wherever else they were.
 *
 * A person belongs to exactly one match — they have one sheet, and it can only
 * be played against one opponent. Without the removal, tapping a name into a
 * second slot would silently duplicate them and the divisor would count a match
 * whose result is already spoken for.
 *
 * Assigning null clears the slot.
 */
export function assignToSlot(
  pairs: PickemPair[],
  index: number,
  side: "a" | "b",
  userId: string | null
): PickemPair[] {
  return pairs.map((p, i) => {
    if (i === index) return { ...p, [side]: userId };
    if (userId == null) return p;
    // Evict from any other slot, either side — a person cannot be in two.
    return {
      a: p.a === userId ? null : p.a,
      b: p.b === userId ? null : p.b,
    };
  });
}

/**
 * Pair as many as possible and leave the remainder UNPAIRED.
 *
 * §8.3: randomize does NOT choose who sits out. With uneven sides someone must,
 * and that is a social decision — the runner makes it by looking at the dashed
 * row, which is the whole reason unpaired rows are shown rather than hidden.
 * An algorithm picking would make the choice invisible and unattributable.
 *
 * Produces `max(|A|, |B|)` rows so the surplus side's people each get a row of
 * their own, dashed. Collapsing them into one "not playing" line would hide
 * WHICH of them is out, which is exactly the thing the runner needs to see.
 *
 * `shuffle` is injected so the test can be deterministic without stubbing
 * global randomness — and so this file has no `Math.random()`, which the
 * workflow runtime forbids anyway.
 */
export function randomizePairs(
  sideA: string[],
  sideB: string[],
  shuffle: <T>(xs: T[]) => T[] = defaultShuffle
): PickemPair[] {
  const a = shuffle([...sideA]);
  const b = shuffle([...sideB]);
  const rows = Math.max(a.length, b.length);
  return Array.from({ length: rows }, (_, i) => ({
    a: a[i] ?? null,
    b: b[i] ?? null,
  }));
}

/** Fisher–Yates. Not exported: callers inject their own for determinism. */
function defaultShuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The blank grid a runner starts from: one row per person on the larger side,
 * every slot empty.
 *
 * Same row count as `randomizePairs`, so switching between manual and randomize
 * does not change the shape of what is on screen — §10's "manual and randomize
 * produce the same shape of result".
 */
export function emptyPairs(sideACount: number, sideBCount: number): PickemPair[] {
  return Array.from({ length: Math.max(sideACount, sideBCount, 0) }, () => ({
    a: null,
    b: null,
  }));
}

/** Serialise for the save. Empty rows are DROPPED — a row with no one in it is
 *  a piece of UI scaffolding, not a match, and persisting it would put a
 *  permanently-invalid row in `game_matches` for the divisor to skip forever. */
export function pairsToPayload(pairs: PickemPair[]): { a: string | null; b: string | null }[] {
  return pairs.filter((p) => p.a != null || p.b != null).map((p) => ({ a: p.a, b: p.b }));
}

/**
 * Where the PAIRING and the ROSTERS disagree.
 *
 * ── Two sources of truth that nothing reconciles ───────────────────────────
 *
 * The grid renders `game_matches` — a SNAPSHOT of who was paired. The picker
 * renders `team_assignments` — who is on a side RIGHT NOW. Change a roster
 * after pairing and the two drift apart silently: a name sits in the grid that
 * appears in neither roster column, and someone sits on a roster who appears in
 * no row. Both are invisible, and together they read as "the builder is showing
 * different people than the matches", which is exactly what it is doing.
 *
 * Nothing auto-repairs it, deliberately — replacing a dropped player is a
 * judgement about who should take the match, not something to guess. So it is
 * SAID instead, and the runner fixes it in one tap.
 *
 * ── UNEVEN is a third thing, and the one that produces a refusal ───────────
 *
 * Sides of 8 and 7 mean one person can never have an opponent, no matter how
 * the pairing is arranged. `open` then refuses on the incompleteness and names
 * that person — a refusal at the END of the flow for a condition knowable at
 * the START, and naming someone the runner then hunts for in a picker that
 * cannot help them. Reporting it here moves the finding to where the cause is.
 *
 * Pure — no React, no ids resolved to names. The caller owns naming.
 */
export interface PairingMismatch {
  /** Paired, but on neither roster now. Their slot needs a live player. */
  offRoster: string[];
  /** On a roster, but in no slot. Available to fill one. */
  unpaired: string[];
  /** How many people on the larger side cannot be given an opponent. */
  unevenBy: number;
  /** Which side is larger — index into the caller's [a, b]. Null when even. */
  largerSide: 0 | 1 | null;
}

export function pairingMismatch(
  pairs: PickemPair[],
  sideAMembers: string[],
  sideBMembers: string[]
): PairingMismatch {
  const placed = pairedMembers(pairs);
  const roster = new Set([...sideAMembers, ...sideBMembers]);

  const offRoster = [...placed].filter((id) => !roster.has(id));
  const unpaired = [...roster].filter((id) => !placed.has(id));

  const diff = sideAMembers.length - sideBMembers.length;
  return {
    offRoster,
    unpaired,
    unevenBy: Math.abs(diff),
    largerSide: diff === 0 ? null : diff > 0 ? 0 : 1,
  };
}
