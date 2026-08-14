/**
 * What a bracket match is WORTH — the numbers its header shows.
 *
 * Pure and client-safe (CLAUDE.md #8), and deliberately scored by the SAME
 * function the payout uses (`pointsForPlacements` → `placementPoints`). A header
 * that computed its own averages would be a second answer to "what is this
 * worth", and the first time they disagreed the board would be lying about the
 * game it is running.
 *
 * ── One formula, every round ────────────────────────────────────────────────
 * Every match says the same two things: **what the loser takes, and what the
 * winner is guaranteed.**
 *
 * The obvious alternative — printing "1st: 7 pts, 2nd: 4 pts" on every match —
 * is false anywhere but the final: a first-round loser is not 2nd, they join a
 * tie group several rounds wide. And the obvious retreat — showing points only
 * on the final, where places are literally paid — leaves the header blank for
 * most of the bracket, which is exactly where people are standing when they ask.
 *
 * The loser/winner-floor formula is true at every depth AND collapses to the
 * literal thing in the final on its own, because there the two tie groups are
 * singletons: the loser takes 2nd exactly and the winner takes 1st exactly. No
 * special case is written for it.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 * `bracketPlacements` places a round-R loser at `2^(lastRound - R) + 1`, tied
 * with everyone else who lost in round R, and `placementPoints` averages a tie
 * group across the places it spans. So the loser's figure is that average, and
 * the winner's floor is the same question asked of the round above — the worst
 * they can now finish is losing their next match.
 *
 * `placementPoints` assigns places by POSITION IN THE SORTED FIELD, not by the
 * position value, so a synthetic full field has to be scored rather than a lone
 * tie group: the group's share depends on how many entrants finished ahead of
 * it. That field is built from the draw's own shape, so byes (which produce no
 * loser) shrink the groups exactly as they do in the real result.
 */

import type { ResolvedMatch } from "./bracketAdvance";
import { pointsForPlacements } from "./placementGroups";

export interface MatchStakes {
  /** Points the loser of this match takes, averaged across their tie group. */
  loser: number;
  /** Points the winner is guaranteed AT WORST — they may still finish higher. */
  winner: number;
  /** True when the winner's figure is exact rather than a floor: the final, and
   *  the consolation match. Lets the header drop a misleading "≥". */
  winnerIsExact: boolean;
}

/**
 * Every position a fully-played version of this draw would hand out.
 *
 * Built from the draw rather than from the entrant count so byes are honoured: a
 * bye produces no loser (nobody played), so it contributes no position and the
 * round's tie group is smaller — which is what the real placement rule does too.
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
    // The play-off splits what would otherwise be a tie for 3rd into 3 and 4 —
    // the whole reason it exists.
    const third = positions.indexOf(3);
    if (third !== -1 && positions.lastIndexOf(3) !== third) positions[positions.lastIndexOf(3)] = 4;
  }
  return positions;
}

/**
 * What this match is worth, or null when the game pays no placement split.
 *
 * Null rather than zeroes: a winner-takes-all or per-match game has no per-place
 * values to quote, and printing "L 0" would state a payout the game does not
 * have. The header renders nothing in that case.
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

  const positions = allPositions(resolved, lastRound);
  // Score the synthetic field once; every entrant at a given position shares the
  // same figure, so one lookup per position answers both questions.
  const scored = pointsForPlacements(
    positions.map((p, i) => ({ entityId: String(i), position: p })),
    distribution
  );
  const pointsAt = (position: number): number => {
    const index = positions.indexOf(position);
    return index === -1 ? 0 : scored.get(String(index)) ?? 0;
  };

  if (match.bracket === "consolation") {
    // Both sides are exact here: this match exists precisely to separate 3 and 4.
    return { loser: pointsAt(4), winner: pointsAt(3), winnerIsExact: true };
  }

  const loserPosition = 2 ** (lastRound - match.round) + 1;
  const isFinal = match.round === lastRound;
  // The winner's floor is the loser's question asked one round up: the worst they
  // can now do is lose their next match. In the final there is no next match.
  const winnerPosition = isFinal ? 1 : 2 ** (lastRound - match.round - 1) + 1;

  return {
    loser: pointsAt(loserPosition),
    winner: pointsAt(winnerPosition),
    winnerIsExact: isFinal,
  };
}

/** Trim a points figure for a 172px-wide card: no trailing `.0`, one decimal
 *  otherwise (a tie-group average is routinely a half). */
export function formatStake(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
