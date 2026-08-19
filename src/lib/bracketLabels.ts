/**
 * What a bracket match is CALLED, and what an undecided seat says.
 *
 * Pure and client-safe, and separate from `bracketAdvance.ts` on purpose: that
 * module answers who is standing where, this one answers how to describe it.
 * Both are structural derivations though — "Match 5" and "Winner of 3" are read
 * off the tree's shape, not authored — so this is a tested module rather than
 * expressions buried in JSX, where an off-by-one would be invisible until
 * someone read a bracket on a phone and found match numbers that skipped.
 *
 * ── Why later rounds read "Winner of 5" ────────────────────────────────────
 * The spec is explicit: later rounds name their feeder rather than showing an
 * empty slot. An empty slot says "nobody is here"; "Winner of 5" says "this is
 * waiting on that match", which is the actual state and tells the reader where
 * to look. It is also what makes a bracket legible before any of it is played.
 */

import { matchKey, type ResolvedMatch } from "./bracketAdvance";

export interface MatchDisplay {
  /** 1-based, sequential across the WHOLE draw — the number printed on the
   *  match card and referenced by every "Winner of N" below it. */
  number: number;
  /** What an unresolved seat says, or null when the seat is filled (or is the
   *  empty half of a bye, which the view renders as "Bye" from its own flag). */
  aPending: string | null;
  bPending: string | null;
  /** PERMANENTLY EMPTY — nobody will ever occupy this seat, as distinct from a seat
   *  waiting on a result. Set only by the double-elim labeller; single elimination has
   *  no such seat, and its one empty-forever case (a bye) is already named by `bye`.
   *  Rendering the two identically is what made an unplayed lower bracket look broken. */
  aVacant?: boolean;
  bVacant?: boolean;
}

/**
 * Number every match and label every undecided seat.
 *
 * NUMBERING is main draw first, in (round, slot) order, then the consolation
 * match. That ordering is what makes "Winner of 5" resolvable by eye: a feeder
 * always carries a LOWER number than the match it feeds, because it sits in an
 * earlier round. The consolation match comes last despite being played
 * alongside the final, since it is the one match nothing feeds from.
 *
 * LABELS follow the same wiring `resolveDraw` advances along — seat A of a
 * later match is fed by the odd slot below it, seat B by the even one — so a
 * label and the seat it describes cannot disagree. The consolation match is the
 * exception in the same way it is there: its seats are the LOSERS of the two
 * semi-finals, so it reads "Loser of 5" / "Loser of 6".
 *
 * A seat that is already filled gets no pending text: the occupant is the
 * label.
 */
export function bracketDisplay(resolved: ResolvedMatch[]): Map<string, MatchDisplay> {
  const main = resolved
    .filter((m) => m.bracket === "main")
    .sort((a, b) => a.round - b.round || a.slot - b.slot);
  const consolation = resolved.filter((m) => m.bracket === "consolation");

  const numbers = new Map<string, number>();
  [...main, ...consolation].forEach((m, i) => numbers.set(matchKey(m), i + 1));

  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);
  const out = new Map<string, MatchDisplay>();

  for (const m of main) {
    const number = numbers.get(matchKey(m))!;
    // Round 1 has no feeders — a null seat there is the empty half of a bye,
    // which the view names from `bye` rather than from a feeder that does not
    // exist.
    const feeder = (seat: "a" | "b") =>
      m.round === 1
        ? null
        : numbers.get(matchKey({ bracket: "main", round: m.round - 1, slot: m.slot * 2 - (seat === "a" ? 1 : 0) })) ?? null;
    out.set(matchKey(m), {
      number,
      aPending: m.aSeed === null && feeder("a") !== null ? `Winner of ${feeder("a")}` : null,
      bPending: m.bSeed === null && !m.bye && feeder("b") !== null ? `Winner of ${feeder("b")}` : null,
    });
  }

  for (const m of consolation) {
    const semi = (slot: number) => numbers.get(matchKey({ bracket: "main", round: lastRound - 1, slot })) ?? null;
    out.set(matchKey(m), {
      number: numbers.get(matchKey(m))!,
      aPending: m.aSeed === null && semi(1) !== null ? `Loser of ${semi(1)}` : null,
      bPending: m.bSeed === null && semi(2) !== null ? `Loser of ${semi(2)}` : null,
    });
  }

  return out;
}

/** Round names, longest-form first: the last round is the Final, the one below
 *  it the Semi-finals, then Quarter-finals. Anything deeper is numbered, because
 *  "Round of 32" is what people actually say once the named rounds run out. */
export function roundName(round: number, lastRound: number): string {
  if (round === lastRound) return "Final";
  if (round === lastRound - 1) return "Semi-finals";
  if (round === lastRound - 2) return "Quarter-finals";
  return `Round ${round}`;
}
