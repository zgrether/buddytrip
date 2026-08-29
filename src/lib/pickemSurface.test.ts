import { describe, it, expect } from "vitest";
import { pickemSurface, type PickemPanel, type PicksSub } from "./pickemSurface";
import type { PickemPhase } from "./pickemLifecycle";

/**
 * BEFORE PICKS LOCK, NOTHING MATTERS EXCEPT PICKS.
 *
 * The whole of this file is that one sentence, checked from every direction the
 * old four-conditions-in-the-JSX version could have got it wrong from.
 */

const surface = (over: {
  phase: PickemPhase;
  openPanel?: PickemPanel;
  picksSub?: PicksSub;
  proxyTargetCount?: number;
}) =>
  pickemSurface({
    openPanel: "matches",
    picksSub: "your",
    proxyTargetCount: 0,
    ...over,
  });

const PRE_LOCK: PickemPhase[] = ["building", "picks_open"];

describe("the tab row arrives at the lock", () => {
  it("shows no tabs in EITHER pre-lock phase, and all three after", () => {
    for (const phase of PRE_LOCK) {
      expect(surface({ phase }).showTabs, phase).toBe(false);
    }
    expect(surface({ phase: "locked" }).showTabs).toBe(true);
  });

  it("cannot render matches or results before the lock, whatever tab was last open", () => {
    /**
     * THE DECISIVE CASE, and the one a naive build fails.
     *
     * `openPanel` is React state that survives a phase change: a runner who was
     * reading Enter results, then pressed Start, still holds "results". If the
     * body branched on the tab alone — which is what four independent
     * conditions amount to — that stale value would resurrect a surface the
     * phase does not have, on a game where no result can exist.
     *
     * So it is asserted across ALL THREE tab values in both pre-lock phases.
     * The `openPanel: "matches"` default alone would pass against a broken
     * build for `building`, where the answer is null either way.
     */
    for (const phase of PRE_LOCK) {
      for (const openPanel of ["matches", "picks", "results"] as const) {
        const s = surface({ phase, openPanel });
        expect(s.panel, `${phase}/${openPanel}`).not.toBe("matches");
        expect(s.panel, `${phase}/${openPanel}`).not.toBe("results");
      }
    }
  });

  it("honours the chosen tab once there are tabs — otherwise the row is decorative", () => {
    // The pair to the case above: the stale value is ignored before the lock
    // and obeyed after it, which is what makes ignoring it a RULE rather than
    // the function simply never reading `openPanel`.
    for (const openPanel of ["matches", "picks", "results"] as const) {
      expect(surface({ phase: "locked", openPanel }).panel, openPanel).toBe(openPanel);
    }
  });
});

describe("the page before the lock", () => {
  it("is NOTHING while building — not a defaulted panel", () => {
    /**
     * Null, never "matches". "The page has no panel" and "the page is showing
     * Matches" are different states, and a caller that cannot tell them apart
     * renders a board on a game nobody has picked in yet.
     */
    expect(surface({ phase: "building" }).panel).toBe(null);
    expect(surface({ phase: "building", openPanel: "picks" }).panel).toBe(null);
  });

  it("IS the sheet while picks are open", () => {
    expect(surface({ phase: "picks_open" }).panel).toBe("picks");
  });
});

describe("the Other picks sub-tab", () => {
  it("is offered after the lock to everyone, with nothing to qualify for", () => {
    // Every sheet is revealed, so there is always somebody to read — including
    // for a viewer the server would let enter for nobody.
    expect(surface({ phase: "locked", proxyTargetCount: 0 }).showPicksSubTabs).toBe(true);
  });

  it("is offered before the lock only to somebody who may enter for another", () => {
    /**
     * The ROW COUNT decides and never a role: `pickem_sheet_status` returns
     * exactly who the caller may act for, and a client-side role test would be
     * a second copy of a policy that lives in one place.
     *
     * The pair is the assertion — a participant with nobody to enter for gets
     * no bar rather than a tab onto an empty list.
     */
    expect(surface({ phase: "picks_open", proxyTargetCount: 0 }).showPicksSubTabs).toBe(false);
    expect(surface({ phase: "picks_open", proxyTargetCount: 1 }).showPicksSubTabs).toBe(true);
  });

  it("never shows a bar while building, whoever is looking", () => {
    expect(surface({ phase: "building", proxyTargetCount: 5 }).showPicksSubTabs).toBe(false);
  });
});

describe("the sub-tab in force", () => {
  it("cannot strand a viewer on a half they have no way back from", () => {
    /**
     * `picksSub` survives a phase change. A captain on Other picks, entering
     * for a teammate, is still on it when the deadline passes — and if the bar
     * is not rendered for them, nothing can move them back. The result would be
     * a blank page.
     *
     * Derived, so the state is unreachable rather than repaired a render later.
     * The pair: the same stored value is HONOURED wherever the bar exists.
     */
    expect(surface({ phase: "picks_open", picksSub: "other", proxyTargetCount: 0 }).sub).toBe(
      "your"
    );
    expect(surface({ phase: "picks_open", picksSub: "other", proxyTargetCount: 3 }).sub).toBe(
      "other"
    );
    expect(surface({ phase: "locked", picksSub: "other", proxyTargetCount: 0 }).sub).toBe(
      "other"
    );
  });

  it("agrees with showPicksSubTabs in every combination", () => {
    /**
     * The INVARIANT rather than another set of cases: "other" may be in force
     * only where there is a bar to have chosen it with. Two booleans that must
     * agree drift exactly like two that must differ, and this is the one
     * statement that covers the whole grid.
     */
    for (const phase of ["building", "picks_open", "locked"] as const) {
      for (const picksSub of ["your", "other"] as const) {
        for (const proxyTargetCount of [0, 2]) {
          const s = surface({ phase, picksSub, proxyTargetCount });
          if (s.sub === "other") {
            expect(s.showPicksSubTabs, `${phase}/${picksSub}/${proxyTargetCount}`).toBe(true);
          }
        }
      }
    }
  });
});
