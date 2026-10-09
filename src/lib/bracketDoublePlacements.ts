/**
 * A finished DOUBLE-ELIMINATION bracket's placements.
 *
 * Pure and client-safe (CLAUDE.md #8), so the finalize preview and the record
 * `games.finish` writes come from one function — the same contract
 * `bracketPlacements.ts` holds for single elimination.
 *
 * ── The conflation this replaces, which was ONE conflation in two places ────
 * Single elim places you the moment you lose: `placed.set(loser, …)` per decided
 * match, keyed by seed. `bracketStakes` counts one awarded position per non-bye match.
 * Both use MATCH COMPLETION AS A PROXY FOR ELIMINATION, and under one life those are
 * the same event, which is why neither looks wrong.
 *
 * Under two lives they come apart, and in the quietest possible way: an entrant loses
 * twice, so `Map.set` runs twice for them and the later call silently overwrites the
 * earlier. No error, no duplicate row, just a wrong place.
 *
 * So the reframing is the same in both places: **count ELIMINATIONS, not matches.** An
 * elimination is a loss that takes an entrant to `lives === 0` — which, in this
 * structure, only ever happens in `lower` or in a grand final. A `main` loss is never
 * an elimination; it is a transfer.
 *
 * ── Why the 4-place cap is structural rather than a special case ────────────
 * The spec caps individual places at 4, then ties below. That falls out of the
 * geometry and needs no branch: the last two `lower` rounds always hold exactly ONE
 * match each (sizes come in pairs and narrow to 1), so exactly one entrant is
 * eliminated in each. 1st and 2nd come from the grand final, 3rd and 4th from those two
 * rounds, and every earlier `lower` round eliminates two or more at once — a genuine
 * tie group. Nothing here reads "4".
 */

import { drawComplete, type ResolvedMatch } from "./bracketAdvance";
import type { EntrantPlacement } from "./bracketPlacements";

/** The loser of a decided, actually-contested match. Null for a bye or an
 *  undecided match — nobody played, or nobody has lost yet. */
function loserOf(m: ResolvedMatch): number | null {
  if (m.bye || m.winnerSeed === null) return null;
  return m.winnerSeed === m.aSeed ? m.bSeed : m.aSeed;
}

/** The last grand final actually played — the reset when it happened, else the first.
 *  Its loser is 2nd, and its winner is the champion. */
function decidedFinal(resolved: ResolvedMatch[]): ResolvedMatch | null {
  const finals = resolved.filter((m) => m.bracket === "final" && m.winnerSeed !== null);
  return finals.sort((a, b) => b.round - a.round)[0] ?? null;
}

/**
 * Where everyone finished.
 *
 * 1st and 2nd come from the last grand final played. Everyone else is placed by WHEN
 * THEY WERE ELIMINATED — the `lower` round in which they took their second loss —
 * with later rounds placing better, because surviving longer in the lower bracket is
 * exactly what finishing higher means here.
 *
 * Each `lower` round's eliminated entrants form one group, and a group's position is
 * the running total of everyone already placed above it. So a round eliminating two
 * people at 5th spans 5–6, and the next round down starts at 7th —
 * `placementPoints` averages a tie group across the places it spans, unchanged from
 * single elim.
 *
 * Returns `[]` for an unfinished draw: callers gate on `drawComplete` and refuse rather
 * than posting a partial result, and returning nothing means a caller that forgets
 * cannot silently record half a bracket. (Same contract as `bracketPlacements`.)
 */
export function doubleBracketPlacements(resolved: ResolvedMatch[]): EntrantPlacement[] {
  // The contract above, made true HERE rather than left to callers (#1417).
  // `decidedFinal` takes any grand final with a winner, so while the RESET is
  // still owed it read the first final and crowned the lower-bracket survivor,
  // with the upper-bracket side still holding a life — and the reset is exactly
  // the match that decides it. The server gated on `drawComplete`; the preview
  // did not. Gating here means no caller can forget.
  if (!drawComplete(resolved)) return [];
  const final = decidedFinal(resolved);
  if (!final || final.winnerSeed === null) return [];

  const placed = new Map<number, number>();
  placed.set(final.winnerSeed, 1);
  const runnerUp = loserOf(final);
  if (runnerUp !== null) placed.set(runnerUp, 2);

  // Only the LOWER bracket eliminates a player who PLAYED. A `main` loss is a
  // transfer, not an exit — which is the entire difference from the single-elim
  // rule, stated as code.
  const lower = resolved.filter((m) => m.bracket === "lower");
  const rounds = [...new Set(lower.map((m) => m.round))].sort((a, b) => b - a);

  // A FORFEIT is an exit wherever it happens (ruling 8). In `lower` it is placed by
  // its own round like any elimination; in `main` it is placed with the lower round
  // that loss would have fed — "the round they withdrew", in this format's terms:
  // main round 1 feeds lower round 1, main round r >= 2 feeds lower round 2(r-1)
  // (the inverse of `feederMainRound`). An empty slot two withdrawals left places
  // both of its forfeiters.
  const forfeitsByLowerRound = new Map<number, number[]>();
  const addForfeit = (round: number, seed: number) =>
    forfeitsByLowerRound.set(round, [...(forfeitsByLowerRound.get(round) ?? []), seed]);
  for (const m of resolved) {
    if (m.forfeited.length === 0) continue;
    if (m.bracket === "main") {
      const lowerRound = m.round === 1 ? 1 : 2 * (m.round - 1);
      for (const seed of m.forfeited) addForfeit(lowerRound, seed);
    } else if (m.bracket === "lower" && m.winnerSeed === null) {
      // A walkover's forfeiter is `loserOf` already; only an empty slot is new here.
      for (const seed of m.forfeited) addForfeit(m.round, seed);
    }
  }

  let position = placed.size + 1; // 3rd, once 1st and 2nd are known
  for (const round of rounds) {
    const out = [
      ...lower.filter((m) => m.round === round).map(loserOf),
      ...(forfeitsByLowerRound.get(round) ?? []),
    ].filter((s, i, all): s is number => s !== null && !placed.has(s) && all.indexOf(s) === i);
    if (out.length === 0) continue;
    // Everyone eliminated in the same round ties — they survived equally long.
    for (const seed of out) placed.set(seed, position);
    position += out.length;
  }

  return [...placed.entries()]
    .map(([seed, p]) => ({ seed, position: p }))
    .sort((a, b) => a.position - b.position || a.seed - b.seed);
}

/**
 * Every position a fully-played version of this draw would hand out.
 *
 * The stakes header needs this BEFORE the draw is finished, so it is derived from the
 * STRUCTURE rather than from results: the champion, the runner-up, and one position per
 * elimination the lower bracket can still perform. Byes are honoured the same way the
 * placement rule honours them — a `lower` match that can never be contested eliminates
 * nobody and contributes no position.
 *
 * This is the second half of the same fix. `bracketStakes.allPositions` pushes one
 * position per non-bye MATCH, which under two lives counts roughly twice too many and
 * makes every tie-group average wrong. Counting eliminations gives the right multiset
 * for both formats; they differ only in which matches eliminate.
 */
export function doublePositionsAwarded(resolved: ResolvedMatch[]): number[] {
  const lower = resolved.filter((m) => m.bracket === "lower");
  const rounds = [...new Set(lower.map((m) => m.round))].sort((a, b) => b - a);

  const positions = [1, 2]; // champion + runner-up, from the grand final
  let position = 3;
  for (const round of rounds) {
    // A match with no possible occupants eliminates nobody; one with a single occupant
    // is a bye and eliminates nobody either.
    //
    // `neverContested` rather than `aSeed === null && bSeed === null`, which is what
    // this line used to say. That test is "empty right now", so a lower match merely
    // WAITING on its feeders counted as unfillable and its elimination went missing
    // from the position multiset — the same conflation that produced the phantom bye
    // in the advancement walk, written out a second time here. Both now read the one
    // field the walk propagates.
    const eliminations = lower.filter(
      (m) => m.round === round && !m.bye && !m.neverContested,
    ).length;
    if (eliminations === 0) continue;
    for (let i = 0; i < eliminations; i++) positions.push(position);
    position += eliminations;
  }
  return positions;
}

/**
 * Which two places a double-elim match settles, or null when it settles none.
 *
 * The grand final settles 1st and 2nd. Everything else — including the lower final —
 * settles only the LOSER's place, and a header quoting one number where every sibling
 * quotes two would misdescribe it, so it stays silent. Same principle as single elim:
 * stakes appear where stakes exist, not on every match.
 *
 * Note this deliberately does NOT report the reset separately. The reset settles the
 * same two places as the first final; it is the same question asked again.
 */
export function doubleSettledPlaces(match: ResolvedMatch): [number, number] | null {
  return match.bracket === "final" ? [1, 2] : null;
}
