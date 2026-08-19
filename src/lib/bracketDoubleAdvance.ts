/**
 * DOUBLE-ELIMINATION advancement — who occupies each seat, derived from the winners.
 *
 * Pure and client-safe (CLAUDE.md #8). The companion to `bracketDouble.ts` exactly as
 * `bracketAdvance.ts` is to `bracket.ts`: that module answers "what is the tree?", this
 * one answers "who is standing in it right now?".
 *
 * Nothing here is persisted. `bracket_matches` stores round-1 seeds and at most a
 * `winner_entrant_id` per row; every other occupant is a function of those. Two lives
 * do not change that — they change the arithmetic, not the model.
 *
 * ── The one predicate for "nobody will ever play this" ──────────────────────
 * Two rows in a double-elim draw can exist and never be contested:
 *
 *   1. a lower match whose feeders produced no losers (byes upstream), and
 *   2. the if-necessary final, when the `main` survivor wins the first grand final.
 *
 * They are the same class, and Phase 1 flagged that they must not grow two predicates.
 * They don't — and the reason is that the EXISTING model already answers it: a match
 * with a null seat is not `playable`, and `drawComplete` is `every(m => !m.playable)`.
 * So both cases are handled by giving such a row NO OCCUPANTS, which is true of it
 * anyway. No new flag, no second definition of done, and nothing for a caller to
 * remember. The tell that this has been got wrong later: any predicate named something
 * like `isPhantom` appearing beside `playable`.
 *
 * ── FEEDS, and why a seat needs three states rather than two ────────────────
 * A seat is not "filled or empty". It is filled, *waiting*, or *permanently empty* —
 * and conflating the last two is what breaks byes in the lower bracket. If a `main`
 * round-1 bye sends no loser down, the lower seat it feeds is not waiting for anyone;
 * it is never going to be occupied, and the entrant beside it should advance free
 * rather than stall. `Feed.empty` carries that distinction, and it is the whole reason
 * odd entrant counts work.
 */

import { isBye, type BracketDrawMatch } from "./bracket";
import { matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";
import { dropSlot, feederMainRound, lowerRoundCount } from "./bracketDouble";

/**
 * What arrives at a seat from the match below it.
 *
 *   { seed: 4,    empty: false }  someone is here
 *   { seed: null, empty: false }  waiting on a result
 *   { seed: null, empty: true  }  nobody is EVER coming (an upstream bye, or a row
 *                                 that itself was never played)
 */
interface Feed {
  seed: number | null;
  empty: boolean;
}

const WAITING: Feed = { seed: null, empty: false };
const NEVER: Feed = { seed: null, empty: true };

/** The winner leaving a resolved match, as a feed. A match nobody played sends
 *  nobody; a bye sends its lone occupant without a recorded result. */
function winnerFeed(m: ResolvedMatch | undefined): Feed {
  if (!m) return NEVER;
  if (m.aSeed === null && m.bSeed === null) return NEVER; // never contested
  if (m.bye) return { seed: m.aSeed, empty: false };
  if (m.winnerSeed === null) return WAITING;
  return { seed: m.winnerSeed, empty: false };
}

/**
 * The LOSER leaving a resolved match, as a feed.
 *
 * A bye produces no loser — nobody played, so nobody lost. That is the single most
 * consequential line in this file at odd entrant counts: it is what turns a lower seat
 * into permanently-empty rather than perpetually-waiting.
 */
function loserFeed(m: ResolvedMatch | undefined): Feed {
  if (!m) return NEVER;
  if (m.bye) return NEVER;
  if (m.aSeed === null && m.bSeed === null) return NEVER;
  if (m.winnerSeed === null) return WAITING;
  return { seed: m.winnerSeed === m.aSeed ? m.bSeed : m.aSeed, empty: false };
}

/** Resolve one match from its two feeds. A seat whose feed is permanently empty stays
 *  null, and a match with exactly one occupant and one permanently-empty seat is a BYE:
 *  its occupant advances without a result, the same answer round 1 already gives. */
function fromFeeds(m: BracketDrawMatch, a: Feed, b: Feed, recorded: number | null): ResolvedMatch {
  const aSeed = a.seed;
  const bSeed = b.seed;
  const bye = (aSeed !== null && b.empty) || (bSeed !== null && a.empty);
  // A bye's occupant may be sitting in either seat, so normalise it into A — every
  // consumer reads a bye's survivor from `aSeed` (`winnerFeed` above included).
  const occupant = aSeed ?? bSeed;
  const winnerSeed = bye
    ? occupant
    : aSeed !== null && bSeed !== null && (recorded === aSeed || recorded === bSeed)
      ? recorded
      : null;

  return {
    ...m,
    aSeed: bye ? occupant : aSeed,
    bSeed: bye ? null : bSeed,
    winnerSeed,
    bye,
    playable: !bye && aSeed !== null && bSeed !== null && winnerSeed === null,
    decidable: !bye && aSeed !== null && bSeed !== null,
  };
}

/**
 * Resolve a whole double-elimination draw.
 *
 * Order matters and is the reason this is a single pass rather than a fixed point:
 * `main` resolves first (it depends on nothing else), then the lower rounds in
 * ascending order (each depends on the lower round below it and on one `main` round),
 * then the grand final (depends on both), then the if-necessary final (depends on the
 * grand final). Nothing ever needs to look upward.
 */
export function resolveDoubleDraw(draw: BracketDrawMatch[], winners: WinnerBySeed = {}): ResolvedMatch[] {
  if (draw.length === 0) return [];
  const won = (m: BracketDrawMatch) => winners[matchKey(m)] ?? null;
  const resolved = new Map<string, ResolvedMatch>();

  // ── main ────────────────────────────────────────────────────────────────
  const main = draw.filter((m) => m.bracket === "main");
  const mainLast = main.reduce((max, m) => Math.max(max, m.round), 0);
  for (let round = 1; round <= mainLast; round++) {
    for (const m of main.filter((x) => x.round === round)) {
      if (round === 1) {
        const bye = isBye(m);
        const rec = won(m);
        resolved.set(matchKey(m), {
          ...m,
          winnerSeed: bye ? m.aSeed : rec === m.aSeed || rec === m.bSeed ? rec : null,
          bye,
          playable: !bye && m.aSeed !== null && m.bSeed !== null && (rec === m.aSeed || rec === m.bSeed ? false : true),
          decidable: !bye && m.aSeed !== null && m.bSeed !== null,
        });
      } else {
        const feedA = winnerFeed(resolved.get(matchKey({ bracket: "main", round: round - 1, slot: m.slot * 2 - 1 })));
        const feedB = winnerFeed(resolved.get(matchKey({ bracket: "main", round: round - 1, slot: m.slot * 2 })));
        resolved.set(matchKey(m), fromFeeds(m, feedA, feedB, won(m)));
      }
    }
  }

  // ── lower ───────────────────────────────────────────────────────────────
  // Round 1 pairs `main` round 1's losers: lower slot i takes the losers of main slots
  // 2i-1 and 2i. Minor rounds (odd, >1) halve the survivors. Major rounds (even) put a
  // survivor against a `main` dropper, mapped through `dropSlot` — the SAME function
  // the tree builder used, imported rather than re-derived, because a second copy of
  // the drop map is exactly how shape and resolution come to disagree.
  const lowerRounds = lowerRoundCount(countEntrantsFrom(draw));
  const lower = draw.filter((m) => m.bracket === "lower");
  for (let round = 1; round <= lowerRounds; round++) {
    const inRound = lower.filter((x) => x.round === round);
    for (const m of inRound) {
      let a: Feed, b: Feed;
      if (round === 1) {
        a = loserFeed(resolved.get(matchKey({ bracket: "main", round: 1, slot: m.slot * 2 - 1 })));
        b = loserFeed(resolved.get(matchKey({ bracket: "main", round: 1, slot: m.slot * 2 })));
      } else if (round % 2 === 1) {
        a = winnerFeed(resolved.get(matchKey({ bracket: "lower", round: round - 1, slot: m.slot * 2 - 1 })));
        b = winnerFeed(resolved.get(matchKey({ bracket: "lower", round: round - 1, slot: m.slot * 2 })));
      } else {
        a = winnerFeed(resolved.get(matchKey({ bracket: "lower", round: round - 1, slot: m.slot })));
        const mainRound = feederMainRound(round)!;
        b = loserFeed(resolved.get(matchKey({ bracket: "main", round: mainRound, slot: dropSlot(m.slot, inRound.length) })));
      }
      resolved.set(matchKey(m), fromFeeds(m, a, b, won(m)));
    }
  }

  // ── the grand final, and the one that may not happen ────────────────────
  const gf1 = draw.find((m) => m.bracket === "final" && m.round === 1);
  const gf2 = draw.find((m) => m.bracket === "final" && m.round === 2);
  let gf1Resolved: ResolvedMatch | undefined;
  if (gf1) {
    const fromMain = winnerFeed(resolved.get(matchKey({ bracket: "main", round: mainLast, slot: 1 })));
    const fromLower = lowerRounds === 0
      ? NEVER
      : winnerFeed(resolved.get(matchKey({ bracket: "lower", round: lowerRounds, slot: 1 })));
    gf1Resolved = fromFeeds(gf1, fromMain, fromLower, won(gf1));
    resolved.set(matchKey(gf1), gf1Resolved);
  }
  if (gf2) {
    /**
     * THE RESET, and why its seats are the whole mechanism.
     *
     * The `main` survivor arrives at the grand final with 2 lives; the `lower` survivor
     * arrives with 1. So the first final is an elimination match FOR ONE SIDE ONLY —
     * which is why a `match.isElimination` boolean would be wrong here, and why the
     * glossary models lives per entrant instead.
     *
     * If the lower survivor wins it, both hold one loss and nobody has two: the bracket
     * has not produced a champion, so a second final is played. Automatic, no toggle.
     *
     * If the `main` survivor wins it, they finish undefeated and this row is never
     * contested. Its seats stay NULL — not as a special case, but because that is
     * literally true of it — and `playable` is therefore false, so `drawComplete` does
     * not wait for it. That is the same answer an unfillable lower match gets, from the
     * same rule, which is what keeps this to one predicate.
     */
    const lowerSurvivor = gf1Resolved?.bSeed ?? null;
    const resetNeeded =
      gf1Resolved != null && lowerSurvivor !== null && gf1Resolved.winnerSeed === lowerSurvivor;
    const a: Feed = resetNeeded ? { seed: gf1Resolved!.aSeed, empty: false } : NEVER;
    const b: Feed = resetNeeded ? { seed: lowerSurvivor, empty: false } : NEVER;
    resolved.set(matchKey(gf2), fromFeeds(gf2, a, b, won(gf2)));
  }

  return draw.map((m) => resolved.get(matchKey(m))!);
}

/** Entrant count implied by a stored draw — read off `main` round 1's seats rather
 *  than passed in, so resolution works against the PERSISTED tree even if the field was
 *  edited afterwards (the same reason `resolveDraw` takes the draw as data). */
function countEntrantsFrom(draw: BracketDrawMatch[]): number {
  const r1 = draw.filter((m) => m.bracket === "main" && m.round === 1);
  return r1.reduce((n, m) => n + (m.aSeed !== null ? 1 : 0) + (m.bSeed !== null ? 1 : 0), 0);
}

/**
 * Losses per seed, over a resolved double-elim draw.
 *
 * The basis of `lives` (glossary: `lives = 2 - losses`, alive at 2 or 1, eliminated at
 * 0) and the input Phase 3 needs. Counts LOSSES, not matches — a bye produces neither
 * a loss nor an elimination, and the reset final's loser is losing for the second time
 * exactly like anyone else.
 */
export function lossesBySeed(resolved: ResolvedMatch[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of resolved) {
    if (m.winnerSeed === null || m.bye) continue;
    const loser = m.winnerSeed === m.aSeed ? m.bSeed : m.aSeed;
    if (loser === null) continue;
    out.set(loser, (out.get(loser) ?? 0) + 1);
  }
  return out;
}

/** Lives remaining for a seed: 2 minus losses, floored at 0. Bracket-local — this must
 *  not travel to the competition layer, which correctly knows nothing about brackets. */
export function livesOf(losses: ReadonlyMap<number, number>, seed: number): number {
  return Math.max(0, 2 - (losses.get(seed) ?? 0));
}

/**
 * Is this match must-win for the given seed — "if I lose this, am I out?"
 *
 * PER SIDE, deliberately. At the grand final one side has two lives and the other has
 * one, so the same match is must-win for one entrant and not the other. A match-level
 * boolean cannot express that and would be wrong at exactly the match people care most
 * about.
 */
export function isMustWin(losses: ReadonlyMap<number, number>, seed: number): boolean {
  return livesOf(losses, seed) === 1;
}
