import type { PlaceCapacity } from "@/lib/gameConfig";

/**
 * How many finishing places a game HAS — the ceiling a placement split is
 * validated against (`validatePlacement`).
 *
 * ── Why this is one module and not five expressions ─────────────────────────
 * The answer was `teams.length` at every call site, spelled slightly differently
 * each time: `teams.length || null` in one view, `teamsQ.data?.length ?? null` in
 * another, `teamCountForGame()` on the server, and an `entityCount` prop threaded
 * through a third. Five derivations of one number is how a sixth gets it wrong —
 * and the bracket is the sixth, because it is the first format whose answer is
 * NOT the team count.
 *
 * Callers ask this module; they do not assemble a `PlaceCapacity` inline.
 */

/**
 * The default: formats whose places are TEAMS in the competition.
 *
 * `computeCompetitionLeaderboard` ranks team ids and reads only
 * `entity_type='team'` results, so for stroke and non-golf the number of
 * distinguishable finishing positions is exactly the number of teams.
 *
 * A null/absent count means "not knowable yet" — a game configured before its
 * competition has teams, or a query in flight — and never refuses.
 */
export function teamPlaceCapacity(teamCount: number | null | undefined): PlaceCapacity {
  return { count: teamCount ?? null, source: "teams" };
}

/**
 * A bracket's ceiling is its FIELD — how many entrants there are.
 *
 * ── This REVISES #915, which returned 2 (or 4 with a consolation match) ─────
 * That was reasoned from what a single-elimination tree DISTINGUISHES: only the
 * finalists are separated, and a consolation match separates 3rd from 4th. True
 * as far as it goes, and the wrong question. It confused how many places a
 * bracket can PAY with how many it can TELL APART, and baked the smaller number
 * into the settings as a hard ceiling.
 *
 * A bracket can pay further down than it separates. Elimination round is itself a
 * ranking: in an 8-entrant draw the quarter-final losers finish 5th–8th, tied,
 * and `placementPoints` already handles exactly that — a tie group shares the sum
 * of the places it spans, averaged. So an 8-place split over 8 entrants pays
 * 1st, 2nd, the two semi-final losers averaged across 3rd/4th, and the four
 * quarter-final losers averaged across 5th–8th. Nothing new is needed to award
 * it; the old ceiling simply refused to let anyone configure it.
 *
 * So the consolation match decides what the bracket DISTINGUISHES (3rd vs 4th
 * rather than two tied thirds) — a result-shape question, settled at compute
 * time — and has nothing to do with how many places may be configured. The two
 * were entangled here and are now separate.
 *
 * The ENTRANT count is the honest ceiling, and it is the same rule every other
 * format follows: a place no competitor can occupy is never awarded, so
 * configuring it silently strands points while still counting them toward
 * points-available. Fewer places than entrants stays legitimate, as always.
 *
 * Null below two entrants: there is no draw to play, so the pool is still being
 * built — incomplete, not wrong, and an unknown ceiling never refuses.
 */
export function bracketPlaceCapacity(entrantCount: number | null | undefined): PlaceCapacity {
  const n = entrantCount ?? null;
  return { count: n != null && n >= 2 ? n : null, source: "bracket" };
}

/**
 * The capacity for a game, given what is known about it.
 *
 * `entrantCount` is present only for a bracket; every other format falls through
 * to the team count. Kept as one entry point so a call site does not have to know
 * which formats are special — it passes what it has and gets the right ceiling.
 */
export function placeCapacityFor(
  { entrantCount, teamCount }: { entrantCount?: number | null; teamCount?: number | null }
): PlaceCapacity {
  if (entrantCount != null) return bracketPlaceCapacity(entrantCount);
  return teamPlaceCapacity(teamCount);
}
