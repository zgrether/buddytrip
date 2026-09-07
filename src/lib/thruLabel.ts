/**
 * HOW FAR THROUGH THE ROUND — one formatter, four surfaces.
 *
 * A completed round reads **F**, not "18". That is what a golf leaderboard says
 * and what a golfer expects; "thru 18" is the number restating a fact the letter
 * states better, and it makes a finished player look like they are still on the
 * course at a glance.
 *
 * ── Why a shared helper rather than the expression at each site ─────────────
 *
 * Four places show this: the stroke/scramble board, the rack board, the group
 * cards (shared by stroke, scramble AND rack), and the scorecard's own header.
 * They are the same fact about the same round, so a per-site `n === 18 ? "F"`
 * is four chances to disagree — and the round is not always 18 (a 9-hole game
 * has `unitCount` 9, which is exactly the case a hardcoded 18 gets wrong).
 *
 * `unitCount` is the round's real length from the scorecard schema, never a
 * literal. A zero or unknown count means the round has no length to be finished
 * against, so the raw number is returned rather than a wrong "F".
 */
export function thruLabel(holesPlayed: number, unitCount: number): string {
  if (unitCount > 0 && holesPlayed >= unitCount) return "F";
  return String(holesPlayed);
}

/**
 * The group-card line: "not started", "thru 7", or "F".
 *
 * `thru` is null before anybody tees off — which is a DIFFERENT state from
 * being thru zero holes, and the card says so. `finished` is decided by the
 * caller because only it knows the round's unit count, and it is already the
 * predicate that gates finalize, so the card and the CTA cannot disagree about
 * whether a group is done.
 */
export function groupThruLine(thru: number | null, finished: boolean): string {
  if (thru == null) return "not started";
  return finished ? "F" : `thru ${thru}`;
}
