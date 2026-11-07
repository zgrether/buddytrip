/**
 * Who sees the points cup's decision surfaces, and when (docs/CLINCH_AND_PODIUM.md
 * §5, v2.8). Pure, so the gates are tests rather than a reading of the board's
 * component, which no node test renders.
 */

/** The empty board's sheet: the ask, or its tie step. */
export type FinishStep = "ask" | "ties";

/**
 * Which step of the finish sheet is open, or null.
 *
 * Only someone who can decide (an Owner or Organizer, `canEdit`) ever gets it,
 * and only while the cup is waiting. It opens by itself once per visit, while
 * the board is on screen and not under a game panel, until it is closed; the
 * card's own button opens it at a step whatever the visit holds.
 */
export function finishSheetStep(s: {
  canEdit: boolean;
  awaitingFinish: boolean;
  openedAt: FinishStep | null;
  closedThisVisit: boolean;
  boardShown: boolean;
  boardUncovered: boolean;
}): FinishStep | null {
  if (!s.canEdit || !s.awaitingFinish) return null;
  if (s.openedAt) return s.openedAt;
  return !s.closedThisVisit && s.boardShown && s.boardUncovered ? "ask" : null;
}

/**
 * The ties ⚙ Tiebreaks offers: at Final only. Before it the board carries its
 * ties for the finish's own tie step, and the gear has nothing to reopen.
 */
export function settingsTies<T>(clinch: { final: boolean; ties: readonly T[] } | null | undefined): T[] {
  return clinch?.final ? [...clinch.ties] : [];
}
