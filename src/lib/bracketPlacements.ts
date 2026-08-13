/**
 * A finished bracket's PLACEMENTS — where each entrant finished.
 *
 * Pure and client-safe (CLAUDE.md #8), so the preview a finalize screen shows
 * and the record `games.finish` writes come from one function.
 *
 * ── Elimination round IS the ranking ───────────────────────────────────────
 * A bracket does not need a separate ranking pass. Losing in round R places you
 * exactly as well as everyone else who lost in round R, because the tree already
 * sorted you into it: the four quarter-final losers of an 8-draw are 5th–8th,
 * tied, and `placementPoints` averages a tie group across the places it spans.
 * That is what #916 established when it made a bracket's place ceiling its
 * FIELD rather than its tree's arity, and this is the function that cashes it.
 *
 * ── Storage, not a mandate ─────────────────────────────────────────────────
 * Every entrant gets a placement, always — including in a winner-takes-all
 * bracket. This function does not know or ask how many places the distribution
 * pays; it records where people finished, and the distribution decides what that
 * is worth. A one-element distribution pays place 1 and nothing else, through
 * the same path, with no branch here.
 *
 * The tell that this has been got wrong: any read of the distribution's LENGTH
 * in this file. Length is the payout's business, never the record's.
 */

import { type ResolvedMatch } from "./bracketAdvance";

export interface EntrantPlacement {
  seed: number;
  /** 1-based finishing position. EQUAL positions are a genuine tie group —
   *  `placementPoints` averages the places they span, which is how four
   *  quarter-final losers share 5th–8th. */
  position: number;
}

/**
 * Where everyone finished, from the resolved draw.
 *
 * The place a round-R loser takes is `2^(lastRound - R) + 1`: the final's loser
 * is 2nd, the semi-finals' losers tie at 3rd (spanning 3–4), the quarters' tie
 * at 5th (spanning 5–8), and so on. That is the size of the sub-tree they were
 * eliminated from, which is exactly how many competitors are at least as far
 * along as they are.
 *
 * A BYE produces no loser and so places nobody — nobody played it. The entrant
 * who received it is placed by the round they eventually lose, like everyone
 * else.
 *
 * The CONSOLATION match, when present and decided, splits what would otherwise
 * be a tie for 3rd into a real 3rd and 4th. That is the whole reason it exists:
 * it does not change what the bracket PAYS (the distribution does that), it
 * changes what the bracket can TELL APART. Undecided, the tie stands — an
 * unplayed play-off cannot separate anyone.
 *
 * Returns `[]` for an unfinished draw. Callers gate on `drawComplete` and refuse
 * rather than posting a partial result; returning nothing here means a caller
 * that forgets cannot silently record half a bracket.
 */
export function bracketPlacements(resolved: ResolvedMatch[]): EntrantPlacement[] {
  const main = resolved.filter((m) => m.bracket === "main");
  if (main.length === 0) return [];
  const lastRound = main.reduce((max, m) => Math.max(max, m.round), 0);

  const final = main.find((m) => m.round === lastRound && m.slot === 1);
  if (!final || final.winnerSeed === null) return [];

  const placed = new Map<number, number>();
  placed.set(final.winnerSeed, 1);

  // Everyone else is placed by the round they lost in. The final's loser falls
  // out of the same formula: 2^0 + 1 = 2.
  for (const m of main) {
    if (m.winnerSeed === null) continue;
    const loser = m.winnerSeed === m.aSeed ? m.bSeed : m.aSeed;
    if (loser === null) continue; // a bye: nobody played, so nobody lost
    placed.set(loser, 2 ** (lastRound - m.round) + 1);
  }

  // The play-off splits the tie it was added to split.
  const consolation = resolved.find((m) => m.bracket === "consolation");
  if (consolation && consolation.winnerSeed !== null) {
    const loser = consolation.winnerSeed === consolation.aSeed ? consolation.bSeed : consolation.aSeed;
    placed.set(consolation.winnerSeed, 3);
    if (loser !== null) placed.set(loser, 4);
  }

  return [...placed.entries()]
    .map(([seed, position]) => ({ seed, position }))
    .sort((a, b) => a.position - b.position || a.seed - b.seed);
}

/**
 * Roll entrant placements up to per-team points.
 *
 * `pointsByEntrant` is what the shared placement scorer returned for each
 * entrant — this only sums it onto teams, and sums rather than picks a best
 * because a team genuinely earns from every entrant it fielded. A team finishing
 * 1st and 5th has done better than one finishing 1st alone, and the distribution
 * is what decides by how much.
 *
 * An entrant with no team contributes nothing and is skipped rather than
 * dropped from scoring elsewhere: standalone brackets have no teams at all, and
 * this is the roll-up, not the record.
 *
 * ── Generic in the entrant KEY, on purpose ──────────────────────────────────
 * Its two callers hold entrants under different names and both are right. The
 * client preview works in SEEDS, because that is what the resolved draw speaks
 * and what the pure placement rule above returns. The leaderboard works in
 * `bracket_entrants.id`, because that is what `game_results.entity_id` stores.
 * Pinning this to one of them would force the other to translate — and a
 * seed↔id round trip inserted purely to satisfy a signature is a second place
 * for the mapping to be wrong. The roll-up doesn't care what an entrant is
 * called; it only needs the two maps to agree with each other, which the type
 * parameter states exactly.
 */
export function teamPointsFromEntrants<K>(
  pointsByEntrant: ReadonlyMap<K, number>,
  teamByEntrant: ReadonlyMap<K, string | null>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [entrant, points] of pointsByEntrant) {
    const teamId = teamByEntrant.get(entrant) ?? null;
    if (teamId === null) continue;
    out.set(teamId, (out.get(teamId) ?? 0) + points);
  }
  return out;
}

/** Convenience for the write path: the placement rows keyed by entrant ID. Kept
 *  here so the seed→id composition lives beside the placement rule rather than
 *  being re-derived at the call site. */
export function placementRows(
  placements: readonly EntrantPlacement[],
  idOfSeed: (seed: number) => string
): { entityId: string; position: number }[] {
  return placements.map((p) => ({ entityId: idOfSeed(p.seed), position: p.position }));
}

/** Is this bracket finished enough to post? Every match that CAN be decided is.
 *  Re-exported intent: `drawComplete` already answers it, and callers should not
 *  invent a second definition of "done". */
export { drawComplete } from "./bracketAdvance";
