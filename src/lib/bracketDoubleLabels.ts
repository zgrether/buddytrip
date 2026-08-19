/**
 * What a DOUBLE-ELIMINATION match is called, and what each undecided seat says.
 *
 * The counterpart to `bracketLabels.ts`, which numbers `main` only — so lower and
 * final cards rendered as "Match" with no number, and every unfilled seat in them
 * rendered as `—`. This is a RENDERING module: it derives labels from the resolved
 * draw and changes nothing about the walk.
 *
 * ── Numbering: one sequence across the whole tournament ─────────────────────
 * Every match gets a number, continuous across all three brackets — upper in
 * (round, slot) order, then lower, then the two finals. That is the crew's own
 * spreadsheet convention (G1–G7: pure identifiers, no round names), which was legible
 * to everyone using it, and it is the property the placeholders need: "Loser of 4"
 * names exactly one match with no vocabulary to learn first.
 *
 * A feeder does not always carry a lower number than the match it feeds here, and it
 * cannot: a lower-bracket match is fed by an upper match numbered below it AND by a
 * lower match numbered just before it. Single elim gets that ordering for free because
 * its tree only flows one way. Continuous numbering is still unambiguous, which is the
 * requirement — "read it off by eye" is a property double elimination does not have to
 * give, whatever numbering is chosen.
 *
 * ── The three seat states, which the render was collapsing to two ───────────
 * Phase 2 established that a seat is FILLED, WAITING, or PERMANENTLY EMPTY, and that
 * conflating the last two is what breaks byes in the lower bracket. The board rendered
 * waiting and permanently-empty identically, as `—`, which is why an unplayed lower
 * bracket looked broken rather than reserved.
 *
 *   filled            the occupant is the label
 *   waiting           name its SOURCE — "Loser of 4" — so the reader knows where to look
 *   permanently empty `vacant`, rendered as its own thing, and NEVER given a
 *                     placeholder naming a match that will never feed it
 *
 * The distinction is derived here rather than read off the model, because the model
 * does not expose it per seat — `Feed.empty` is internal to the resolver. It is
 * recomputed from the same structural rules (a bye produces no loser; a match with no
 * occupants produces no winner), using the SAME exported geometry the tree was built
 * from, so the two cannot describe different trees.
 */

import { matchKey, type ResolvedMatch } from "./bracketAdvance";
import type { MatchDisplay } from "./bracketLabels";
import { dropSlot, feederMainRound } from "./bracketDouble";

/** A seat's source: which match it comes from, and whether it takes that match's
 *  winner or its loser. Null when the seat has no feeder (upper round 1). */
type Source = { key: string; take: "winner" | "loser" } | null;

const key = (bracket: string, round: number, slot: number) => `${bracket}:${round}:${slot}`;

/**
 * Where each seat of each match comes from — the structure, independent of results.
 *
 * This is the drop pattern and the advancement rules stated once, for labelling. It
 * imports `dropSlot` and `feederMainRound` rather than restating them: a second copy of
 * the drop map is how the board comes to name a different feeder than the one the
 * resolver actually advances from, which would be worse than no label at all.
 */
function sourcesOf(m: ResolvedMatch, lowerCounts: Map<number, number>, mainLast: number, lowerLast: number): [Source, Source] {
  if (m.bracket === "main") {
    if (m.round === 1) return [null, null];
    return [
      { key: key("main", m.round - 1, m.slot * 2 - 1), take: "winner" },
      { key: key("main", m.round - 1, m.slot * 2), take: "winner" },
    ];
  }
  if (m.bracket === "lower") {
    if (m.round === 1) {
      // The lower bracket STARTS with upper round 1's losers — they do not "drop" into
      // it, which is why no major round claims them.
      return [
        { key: key("main", 1, m.slot * 2 - 1), take: "loser" },
        { key: key("main", 1, m.slot * 2), take: "loser" },
      ];
    }
    if (m.round % 2 === 1) {
      // MINOR: survivors play each other, halving the field.
      return [
        { key: key("lower", m.round - 1, m.slot * 2 - 1), take: "winner" },
        { key: key("lower", m.round - 1, m.slot * 2), take: "winner" },
      ];
    }
    // MAJOR: a survivor meets the batch dropping from `main`, reversed against the
    // slot order so nobody immediately replays whoever just knocked them down.
    const count = lowerCounts.get(m.round) ?? 1;
    return [
      { key: key("lower", m.round - 1, m.slot), take: "winner" },
      { key: key("main", feederMainRound(m.round)!, dropSlot(m.slot, count)), take: "loser" },
    ];
  }
  // The grand final: the two streams converge. Round 2 is contested by the SAME two
  // entrants, which is exactly "the winner and the loser of round 1" — so it can name
  // its sources honestly rather than being left blank.
  if (m.round === 1) {
    return [
      { key: key("main", mainLast, 1), take: "winner" },
      lowerLast > 0 ? { key: key("lower", lowerLast, 1), take: "winner" } : null,
    ];
  }
  return [
    { key: key("final", 1, 1), take: "winner" },
    { key: key("final", 1, 1), take: "loser" },
  ];
}

/**
 * Numbers and seat labels for a double-elim draw.
 *
 * `vacant` marks a seat nobody will ever occupy. It is computed by asking, of each
 * seat's source, whether that source can still produce what the seat takes:
 *
 *   a BYE produces a winner but never a loser — nobody played, so nobody lost;
 *   a match with no occupants at all produces neither;
 *   the if-necessary final is vacant once the upper entrant has won the first final,
 *   because at that point they hold no losses and the tournament is over.
 *
 * Computed in draw order (upper, then lower ascending, then the finals) so a source is
 * always settled before the seat that reads it.
 */
export function doubleBracketDisplay(resolved: ResolvedMatch[]): Map<string, MatchDisplay> {
  const main = resolved.filter((m) => m.bracket === "main").sort((a, b) => a.round - b.round || a.slot - b.slot);
  const lower = resolved.filter((m) => m.bracket === "lower").sort((a, b) => a.round - b.round || a.slot - b.slot);
  const finals = resolved.filter((m) => m.bracket === "final").sort((a, b) => a.round - b.round);
  const ordered = [...main, ...lower, ...finals];
  if (ordered.length === 0) return new Map();

  const numbers = new Map<string, number>();
  ordered.forEach((m, i) => numbers.set(matchKey(m), i + 1));

  const mainLast = main.reduce((max, m) => Math.max(max, m.round), 0);
  const lowerLast = lower.reduce((max, m) => Math.max(max, m.round), 0);
  const lowerCounts = new Map<number, number>();
  for (const m of lower) lowerCounts.set(m.round, (lowerCounts.get(m.round) ?? 0) + 1);

  const byKey = new Map(ordered.map((m) => [matchKey(m), m]));
  /** Can this match still produce a winner / a loser? */
  const produces = new Map<string, { winner: boolean; loser: boolean }>();

  const out = new Map<string, MatchDisplay>();

  for (const m of ordered) {
    const k = matchKey(m);
    const [sa, sb] = sourcesOf(m, lowerCounts, mainLast, lowerLast);

    const seatVacant = (s: Source): boolean => {
      if (s === null) return false;              // upper round 1: seeded, never "waiting"
      const p = produces.get(s.key);
      if (!p) return true;                        // no such match — nothing can arrive
      return s.take === "winner" ? !p.winner : !p.loser;
    };

    let aVacant = m.aSeed === null && seatVacant(sa);
    let bVacant = m.bSeed === null && seatVacant(sb);

    // The if-necessary final. Undecided first final → still possible, so NOT vacant:
    // it must read as a possibility before it is played or its appearance looks like a
    // bug. Decided in the upper entrant's favour → it will never be played.
    if (m.bracket === "final" && m.round === 2) {
      const gf1 = byKey.get(key("final", 1, 1));
      const settledByUpper =
        !!gf1 && gf1.winnerSeed !== null && gf1.winnerSeed === gf1.aSeed;
      aVacant = bVacant = settledByUpper;
    }

    const label = (s: Source, vacant: boolean): string | null => {
      if (s === null || vacant) return null;
      const n = numbers.get(s.key);
      if (n === undefined) return null;
      return `${s.take === "winner" ? "Winner" : "Loser"} of ${n}`;
    };

    out.set(k, {
      number: numbers.get(k)!,
      aPending: m.aSeed === null ? label(sa, aVacant) : null,
      // `m.bye` keeps its existing meaning on the B seat: the view names it "Bye".
      bPending: m.bSeed === null && !m.bye ? label(sb, bVacant) : null,
      aVacant,
      bVacant: bVacant && !m.bye,
    });

    // What this match can still send onward. A bye advances its occupant but produces
    // no loser; a match with both seats permanently empty produces nothing at all.
    const bothEmpty = aVacant && bVacant;
    produces.set(k, {
      winner: !bothEmpty,
      loser: !bothEmpty && !m.bye && !(aVacant || bVacant),
    });
  }

  return out;
}

/**
 * Round names under double elimination.
 *
 * "Quarter-finals / Semi-finals / Final" encode ELIMINATION DISTANCE, which is a
 * single-elim property: those rounds eliminate nobody here, because their losers drop
 * to the lower bracket, so the names assert stakes that do not exist. And the upper
 * bracket's last round is not the final — the grand final is.
 *
 * Single elimination keeps its names, where they are correct. `roundName` is untouched.
 */
export function doubleRoundName(bracket: string, round: number, last: number): string {
  if (bracket === "final") return round === 1 ? "Grand Final" : "If Necessary";
  if (bracket === "lower") return round === last ? "Lower Final" : `Lower ${round}`;
  return round === last ? "Upper Final" : `Upper ${round}`;
}
