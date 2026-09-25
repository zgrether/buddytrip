import { outcomeCellKey, type OutcomeValues } from "@/components/games/types";
import type { HoleOutcomeResult } from "@/lib/matchPlay";
import { reconcileCells } from "@/lib/cellReconcile";

/**
 * reconcileOutcomes — the pure merge behind useOutcomeSaver.reconcile: server
 * truth into a device's hole-outcome entry state.
 *
 * It USED to be a fork of `reconcileScores` ("forked, not genericized", Refactor
 * B Phase 0) with a "deliberate gap": a remotely CLEARED outcome was never
 * removed, and nothing called it anyway. Both are reversed by #1437 — two phones
 * that scored a hole differently stayed apart for as long as both stayed on the
 * entry view, and a clear on one never reached the other. The rule is now the
 * one `reconcileCells` states for both entry modes: server truth, except
 * protected cells, including removal. Only the cell KEY differs (match + hole).
 */
export function reconcileOutcomes(
  local: OutcomeValues,
  server: OutcomeValues,
  protectedKeys: ReadonlySet<string>,
): OutcomeValues {
  return reconcileCells(local, server, protectedKeys, (mid, hole) => outcomeCellKey(mid, Number(hole)));
}

/** A hole THIS device entered, whose value the server now holds differently. */
export interface OutcomeOverwrite {
  matchId: string;
  hole: number;
  /** What the hole is now — null when it was cleared. */
  to: HoleOutcomeResult | null;
}

/**
 * Which holes this device entered have been OVERWRITTEN — the notice's decision
 * (#1437, Zach's ruling), pure so it can be tested without a renderer.
 *
 * Last write wins, as it does in any shared sheet. What makes a golf hole
 * different from a spreadsheet cell is that two players tapping different
 * results are DISAGREEING about what happened, and the overwrite usually lands
 * after both have moved on — so the player on the next hole sees the status
 * jump with no visible cause. So:
 *
 *  - SILENT when the two agree, or when this device never entered the hole (it
 *    only watched) — the overwhelmingly common case;
 *  - a notice when a hole this device entered now holds a DIFFERENT value, or
 *    was cleared.
 *
 * `entered` is keys this device wrote and still holds. `protectedKeys` are the
 * same keys the merge protects: a write in flight or just confirmed is not
 * overwritten yet, so it cannot be reported as overwritten — which is also what
 * stops a stale in-flight snapshot raising a false notice (CONFIRM_GRACE_MS).
 */
export function outcomeOverwrites(
  local: OutcomeValues,
  server: OutcomeValues,
  protectedKeys: ReadonlySet<string>,
  entered: ReadonlySet<string>,
): OutcomeOverwrite[] {
  const out: OutcomeOverwrite[] = [];
  for (const matchId of Object.keys(local)) {
    for (const hole of Object.keys(local[matchId])) {
      const key = outcomeCellKey(matchId, Number(hole));
      if (!entered.has(key) || protectedKeys.has(key)) continue;
      const mine = local[matchId][hole];
      const theirs = server[matchId]?.[hole] ?? null;
      if (theirs === mine) continue;
      out.push({ matchId, hole: Number(hole), to: theirs });
    }
  }
  return out;
}
