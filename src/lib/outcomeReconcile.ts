import { outcomeCellKey, type OutcomeValues } from "@/components/games/types";

/**
 * reconcileOutcomes — the pure merge behind useOutcomeSaver.reconcile, the
 * hole-outcome-entry counterpart to `reconcileScores` (forked, not genericized —
 * matching the outbox/key-scheme fork decision from B Phase 0).
 *
 * Same rule: keep every local cell, then overlay the server's value for each
 * cell the server has, EXCEPT cells in `protectedKeys` (an unconfirmed local
 * write), which keep their local value. Deliberate gap: a remotely-CLEARED
 * outcome isn't removed here — reflecting adds/edits is the requirement,
 * never-clobber-the-enterer is the hard rule.
 */
export function reconcileOutcomes(
  local: OutcomeValues,
  server: OutcomeValues,
  protectedKeys: ReadonlySet<string>,
): OutcomeValues {
  const next: OutcomeValues = {};
  for (const mid of Object.keys(local)) next[mid] = { ...local[mid] };
  for (const mid of Object.keys(server)) {
    for (const hole of Object.keys(server[mid])) {
      if (protectedKeys.has(outcomeCellKey(mid, Number(hole)))) continue;
      (next[mid] ??= {})[hole] = server[mid][hole];
    }
  }
  return next;
}
