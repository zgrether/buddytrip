import { scoreCellKey, type ScoreValues } from "@/components/games/types";

/**
 * reconcileScores — the pure merge behind useScoreSaver.reconcile (game-state
 * sync). Reflects a remote device's scores into the local view WITHOUT clobbering
 * the person actively entering.
 *
 * Rule: keep every local cell, then overlay the server's value for each cell the
 * server has, EXCEPT cells in `protectedKeys` (an unconfirmed local write —
 * flagged `saving`/`error` or still in the durable outbox, #543), which keep
 * their local value. So a teammate's new/corrected score appears, while a value
 * the enterer just saved is never overwritten by a poll that raced the save (a
 * server payload lacking that cell can't drop it — overlay only SETS
 * server-present cells).
 *
 * Deliberate gap: a score DELETED elsewhere isn't removed here — reflecting
 * adds/edits is the requirement, never-clobber-the-enterer is the hard rule, and
 * dropping-to-exact-server-truth can't guarantee both. Remote clears are rare and
 * self-correct on the next real edit or reopen.
 */
export function reconcileScores(
  local: ScoreValues,
  server: ScoreValues,
  protectedKeys: ReadonlySet<string>,
): ScoreValues {
  const next: ScoreValues = {};
  for (const pid of Object.keys(local)) next[pid] = { ...local[pid] };
  for (const pid of Object.keys(server)) {
    for (const ul of Object.keys(server[pid])) {
      if (protectedKeys.has(scoreCellKey(pid, ul))) continue;
      (next[pid] ??= {})[ul] = server[pid][ul];
    }
  }
  return next;
}
