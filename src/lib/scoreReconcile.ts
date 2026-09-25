import { scoreCellKey, type ScoreValues } from "@/components/games/types";
import { reconcileCells } from "@/lib/cellReconcile";

/**
 * reconcileScores — the pure merge behind useScoreSaver.reconcile (game-state
 * sync). Reflects a remote device's scores into the local view WITHOUT clobbering
 * the person actively entering.
 *
 * Rule: take the server's cells as truth, EXCEPT cells in `protectedKeys` (a
 * local write the server hasn't confirmed — flagged `saving`/`error`, still in
 * the durable outbox (#543), or confirmed within the last few seconds), which
 * keep their local value. So a teammate's new/corrected score appears, while a
 * value the enterer just saved is never overwritten by a poll that raced it.
 *
 * `server` MUST be the game's COMPLETE score set (`scores.listByGame`), because
 * absence is meaningful here: an unprotected local cell the server doesn't have
 * was DELETED elsewhere, and is dropped.
 *
 * That removal is the whole point, and it used to be a documented gap: the merge
 * only ever overlaid, so a clear — which is expressed as absence — was invisible
 * to every device except the one that made it, and only a full exit and re-entry
 * (remounting with empty local state) would show it. Same asymmetry #807 hit on
 * reset. The gap was defensible while "never clobber the enterer" and "drop to
 * exact server truth" looked mutually exclusive; `protectedKeys` is what makes
 * them compatible, so the merge can now express deletion without ever dropping
 * work in flight.
 */
export function reconcileScores(
  local: ScoreValues,
  server: ScoreValues,
  protectedKeys: ReadonlySet<string>,
): ScoreValues {
  // The rule lives in ONE place now, shared with outcome entry (#1437) — see
  // `reconcileCells`. Behaviour unchanged; `scoreReconcile.test.ts` pins it.
  return reconcileCells(local, server, protectedKeys, scoreCellKey);
}
