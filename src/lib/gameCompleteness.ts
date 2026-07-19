/**
 * gameCompleteness — the shared, client-safe finalize gate for the multi-grouping
 * formats (rack + stroke). Both are "every unit of play must be thru every hole"
 * games, so the all-groups-complete check that gates their game-level finalize is
 * ONE function — reused, never re-implemented per format, so the two can't drift.
 *
 * The caller derives `thrus` LIVE from its own scoreboard (rack: both sides of every
 * derived slot; stroke: each player row of the live whole-field leaderboard). Because
 * that derivation reads the CURRENT group set, a mid-round-added group's not-yet-scored
 * units land in `thrus` as 0 and re-block finalize until they're complete too
 * (derive-don't-snapshot).
 *
 * No server/DB deps — pure.
 */

/**
 * True when every unit of play is thru every hole (finalize is allowed).
 *
 * @param thrus     one entry per unit of play — its count of scored holes ("thru").
 *                  Empty ⇒ false (nothing to finalize).
 * @param unitCount holes in the game (`scorecard_schema` unit count) — never a literal.
 *
 * Forward-compat (withdrawals, a filed feature): a withdrawn player is *excluded*, not
 * incomplete — so the caller filters withdrawn units OUT of `thrus` before calling. This
 * fn stays agnostic to that, so it needs no change when withdrawals land.
 */
export function allUnitsComplete(thrus: number[], unitCount: number): boolean {
  return thrus.length > 0 && thrus.every((t) => t >= unitCount);
}
