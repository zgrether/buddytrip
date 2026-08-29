import type { PickemPhase } from "./pickemLifecycle";

/**
 * WHAT IS ON THE PICK'EM PAGE — the one decision, in one pure function.
 *
 * ── Why this is a module and not four conditions in the JSX ────────────────
 *
 * It was four conditions in the JSX, and they disagreed. The tab row, the three
 * panel bodies and the sub-tab bar each carried their own idea of when they
 * belonged on screen, so "does this render before the lock" had four answers
 * that only happened to agree — and the composition it produces is invisible to
 * a per-component test, because every component was correct in isolation.
 *
 * The rule this encodes is one sentence: **before picks lock, nothing matters
 * except picks.** Two of the three tabs are about things that do not exist yet
 * — nobody is in a match, no result has been entered — and for a participant
 * the matches never mattered at pick time anyway: whether a sheet rolls into a
 * team total or a head-to-head changes not one pick they make.
 *
 * ── The view READS this; it does not re-derive it ─────────────────────────
 *
 * That is what makes the tests below say anything. A predicate tested here and
 * re-implemented in the JSX is two implementations, and the test would go on
 * passing while the screen did something else — the failure this project keeps
 * finding under a different name.
 */

/** The three tabs, once there are three tabs. */
export type PickemPanel = "matches" | "picks" | "results";

/** Which half of the Picks tab is showing. */
export type PicksSub = "your" | "other";

export interface PickemSurfaceState {
  /** The three-tab row. Absent until the lock. */
  showTabs: boolean;
  /**
   * Which body renders — null while building, where the page is the runner's
   * panel and one sentence for everybody else.
   *
   * Null rather than a default panel: "the page has no panel" and "the page is
   * showing Matches" are different states, and a caller that cannot tell them
   * apart renders a board on a game nobody has picked in.
   */
  panel: PickemPanel | null;
  /** The Your picks / Other picks bar. */
  showPicksSubTabs: boolean;
  /** Which half of Picks is in force — see `activeSub` below. */
  sub: PicksSub;
}

export function pickemSurface(o: {
  phase: PickemPhase;
  /** The tab last chosen. Only consulted once there ARE tabs. */
  openPanel: PickemPanel;
  /** The sub-tab last chosen. */
  picksSub: PicksSub;
  /**
   * How many people the SERVER says this viewer may enter for —
   * `pickem_sheet_status`, straight through.
   *
   * A count and never a role. The list is the permission (`_pickem_can_proxy_for`
   * decides it, and gates the write), so a client-side role test here would be a
   * second copy of a policy that lives in exactly one place.
   */
  proxyTargetCount: number;
}): PickemSurfaceState {
  if (o.phase === "building") {
    return { showTabs: false, panel: null, showPicksSubTabs: false, sub: "your" };
  }

  /**
   * Is there a second half for the sub-tab bar to switch to?
   *
   * Locked: always — every sheet is revealed, so everyone has somebody to read.
   *
   * Open: only if the viewer may enter for somebody. With no second half the
   * bar is absent rather than offering a tab that opens an empty list, which is
   * what most participants would have got.
   */
  const hasOther = o.phase === "locked" || o.proxyTargetCount > 0;

  /**
   * `picksSub` survives a phase change — a captain who was on Other picks
   * entering for a teammate is still on it when the deadline passes. That is
   * right while the tab exists and a blank screen when it does not, since with
   * no second half the bar is not rendered and nothing can move them back.
   *
   * DERIVED rather than corrected by an effect, so the impossible state is not
   * reachable at all rather than being repaired one render later.
   */
  const sub: PicksSub = hasOther ? o.picksSub : "your";

  // Picks open: the page IS the sheet. No tab row, and `openPanel` is not
  // consulted — a stale "results" from a previous visit must not resurrect a
  // surface this phase does not have.
  if (o.phase === "picks_open") {
    return { showTabs: false, panel: "picks", showPicksSubTabs: hasOther, sub };
  }

  return {
    showTabs: true,
    panel: o.openPanel,
    showPicksSubTabs: hasOther,
    sub,
  };
}
