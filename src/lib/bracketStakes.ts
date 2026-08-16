/**
 * What a bracket match is WORTH — and, more importantly, WHEN that is worth
 * saying.
 *
 * Pure and client-safe (CLAUDE.md #8), scored by the SAME `pointsForPlacements`
 * the payout uses, so the header and the result cannot disagree.
 *
 * ── This REVERSES the "one formula everywhere" call, and the output is why ──
 * The previous version quoted every match: what the loser takes, and what the
 * winner is guaranteed. It was defensible in the abstract and wrong in practice.
 * On a real 16-entrant draw the eight round-one matches all read `W ≥0 · L 0` —
 * two zeroes on half the bracket, which is noise, not information. Worse, the
 * quarter-finals read `W ≥0.5 · L 0`, and 0.5 is the 5th–8th tie-group average
 * the winner has just ESCAPED. That is a false claim in exactly the direction
 * the formula was chosen to avoid.
 *
 * The intent was always to say WHEN a match awards points, not to put a number
 * on every match. So: **stakes appear only where places are actually paid.**
 * The final settles 1st and 2nd. The consolation match, when it is on, settles
 * 3rd and 4th. Everywhere else the header carries no points, because the match
 * awards none directly — its loser lands in a tie group several rounds wide,
 * and that group's value is not this match's stake.
 *
 * ── Not match play's string, deliberately ──────────────────────────────────
 * Match play shows one figure (`4½ PTS`) because the match IS the game: one
 * contest, winner takes it, a draw splits it. A bracket's final settles TWO
 * places, so it reads `1st: 3 · 2nd: 1½`. Two outcomes, two numbers. The shared
 * thing is only the principle — stakes appear where stakes exist — and
 * flattening one into the other would misdescribe whichever lost.
 */

import type { ResolvedMatch } from "./bracketAdvance";
import { pointsForPlacements } from "./placementGroups";
import { fmtValue } from "@/components/competition/CompetitionGamesPanel";

export interface MatchStakes {
  /** Ready-to-render, e.g. `1st: 3 · 2nd: 1½`. */
  label: string;
  /** The better place's value, and the worse one's. Exposed for tests and for
   *  any surface that wants to lay them out differently. */
  better: number;
  worse: number;
}

/**
 * Every position a fully-played version of this draw would hand out.
 *
 * Built from the draw rather than the entrant count so byes are honoured: a bye
 * produces no loser, contributes no position, and the round's tie group is
 * correspondingly smaller — which is what the real placement rule does too.
 */
function allPositions(resolved: readonly ResolvedMatch[], lastRound: number): number[] {
  const hasConsolation = resolved.some((m) => m.bracket === "consolation");
  const positions: number[] = [1]; // the champion

  for (const m of resolved) {
    if (m.bracket !== "main") continue;
    if (m.bye) continue; // nobody played, so nobody lost
    positions.push(2 ** (lastRound - m.round) + 1);
  }

  if (hasConsolation) {
    // The play-off splits what would otherwise be a tie for 3rd into 3 and 4.
    const firstThird = positions.indexOf(3);
    const lastThird = positions.lastIndexOf(3);
    if (firstThird !== -1 && lastThird !== firstThird) positions[lastThird] = 4;
  }
  return positions;
}

/**
 * What this match is worth, or **null when it pays nothing directly** — which is
 * every match except the final and a live consolation play-off.
 *
 * Also null when the game carries no placement split at all: a winner-takes-all
 * or per-match game has no per-place values to quote, and printing zeroes would
 * state a payout the game does not have.
 */
export function matchStakes(
  match: ResolvedMatch,
  resolved: readonly ResolvedMatch[],
  distribution: readonly number[]
): MatchStakes | null {
  if (distribution.length === 0) return null;

  const main = resolved.filter((m) => m.bracket === "main");
  if (main.length === 0) return null;
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);

  const isFinal = match.bracket === "main" && match.round === lastRound;
  const isConsolation = match.bracket === "consolation";
  // The whole gate: everything else awards nothing directly.
  if (!isFinal && !isConsolation) return null;

  const positions = allPositions(resolved, lastRound);
  const scored = pointsForPlacements(
    positions.map((p, i) => ({ entityId: String(i), position: p })),
    distribution
  );
  const pointsAt = (position: number): number => {
    const index = positions.indexOf(position);
    return index === -1 ? 0 : scored.get(String(index)) ?? 0;
  };

  const [betterPlace, worsePlace] = isFinal ? [1, 2] : [3, 4];
  const better = pointsAt(betterPlace);
  const worse = pointsAt(worsePlace);
  const name = (p: number) => (p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : "4th");

  return {
    better,
    worse,
    label: `${name(betterPlace)}: ${fmtValue(better)} · ${name(worsePlace)}: ${fmtValue(worse)}`,
  };
}
