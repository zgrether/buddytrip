/**
 * reconcileCells — the ONE merge of server truth into a device's local entry
 * state, shared by score entry (`reconcileScores`) and hole-outcome entry
 * (`reconcileOutcomes`) (#1437).
 *
 * Rule: take the server's cells as truth, EXCEPT cells in `protectedKeys` (a
 * local write the server hasn't confirmed — saving / error / in the durable
 * outbox — or one confirmed within CONFIRM_GRACE_MS), which keep their local
 * value. `server` must be the game's COMPLETE set, because absence means
 * something: an unprotected local cell the server doesn't have was CLEARED
 * elsewhere, and is dropped.
 *
 * ── Why one function, and not two that happened to match ─────────────────
 *
 * Outcome entry forked this merge from score entry in Refactor B's Phase 0
 * ("forked, not genericized", matching the outbox/key-scheme fork). The fork
 * froze outcome mode at the OLDER rule — overlay only, "remotely-CLEARED
 * outcome isn't removed, deliberate gap" — after score mode had closed that gap.
 * And the hook that owned it was never called at all (#1437): two phones that
 * scored the same hole differently stayed apart for as long as both stayed on
 * the entry view, while production recorded only the last write. Every BBMI
 * 2026 round was outcome mode.
 *
 * The fork's real reason — different cell KEYS (participant+unit vs match+hole)
 * and different outboxes — is kept: `keyOf` is injected, and the outboxes stay
 * separate. What cannot differ is the RULE, so there is one of it.
 */

/** A device's entry state: row → column → value. Scores: participant → unit;
 *  outcomes: match → hole. */
export type CellGrid<V> = Record<string, Record<string, V>>;

/**
 * How long a just-CONFIRMED cell stays protected. A response already in flight
 * when the write landed can arrive after the confirmation carrying the server's
 * older value; without this it would revert the tap for a moment (and, for
 * outcomes, raise a false "changed" notice). Generous against that round trip,
 * short against what it delays (someone else's genuine change reaching this
 * device). Not a correctness knob: the cell is server truth either way once a
 * fetch issued after the write lands. Shared so the two entry modes cannot
 * disagree about it.
 */
export const CONFIRM_GRACE_MS = 10_000;

export function reconcileCells<V>(
  local: CellGrid<V>,
  server: CellGrid<V>,
  protectedKeys: ReadonlySet<string>,
  keyOf: (row: string, col: string) => string,
): CellGrid<V> {
  const next: CellGrid<V> = {};
  // Keep a local cell only if the server still has it, or it is protected.
  for (const row of Object.keys(local)) {
    const kept: Record<string, V> = {};
    for (const col of Object.keys(local[row])) {
      if (server[row]?.[col] != null || protectedKeys.has(keyOf(row, col))) {
        kept[col] = local[row][col];
      }
    }
    next[row] = kept;
  }
  // Overlay server truth — adds and edits from other devices.
  for (const row of Object.keys(server)) {
    for (const col of Object.keys(server[row])) {
      if (protectedKeys.has(keyOf(row, col))) continue;
      (next[row] ??= {})[col] = server[row][col];
    }
  }
  return next;
}
