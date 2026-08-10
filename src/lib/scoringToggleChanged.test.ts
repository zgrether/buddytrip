import { describe, it, expect } from "vitest";
import { scoringToggleChanged } from "@/lib/configDraft";

/**
 * The condition that decides whether a landed settings save may close the panel.
 *
 * Every setting's result is visible where you changed it, so "a landed save
 * closes" is a good default. The Setup/Scoring toggle is the ONE exception: it
 * decides which surface the game view renders, and the panel is covering that
 * surface. Committing it therefore ejected you and you had to re-enter to keep
 * editing — reported as "you have to click save to leave and then come back in
 * to edit something", which turned out to be literal, because Save IS how you
 * leave (`SettingsSaveBar` calls `onLeave` on a landed save).
 *
 * Two decisions are encoded here and both are load-bearing, so both are pinned:
 * the comparison is against the frozen BASELINE rather than the live server
 * value, and it asks whether the toggle CHANGED rather than whether it is SET.
 */

const draft = (scoringEnabled: boolean) => ({ scoringEnabled });

describe("scoringToggleChanged", () => {
  it("is true in both directions of a real change", () => {
    expect(scoringToggleChanged(draft(true), draft(false)), "setup → scoring").toBe(true);
    expect(scoringToggleChanged(draft(false), draft(true)), "scoring → setup").toBe(true);
  });

  it("is CHANGED, not SET — an unchanged toggle never holds the panel open", () => {
    // The distinction that matters: a truthiness test on the draft would keep the
    // panel open for every save on an already-live game, which is most saves. It
    // would also make "flip it and flip it back" behave unlike any other no-op.
    expect(scoringToggleChanged(draft(true), draft(true)), "already live, editing something else").toBe(false);
    expect(scoringToggleChanged(draft(false), draft(false)), "still in setup").toBe(false);
  });

  it("flipping and flipping back is not a change", () => {
    // The draft ends where the baseline began. Such a save is also not dirty, so
    // the button is disabled — but the condition must not depend on that.
    const baseline = draft(false);
    const afterTwoTaps = draft(true).scoringEnabled ? draft(false) : draft(true);
    expect(scoringToggleChanged(afterTwoTaps, baseline)).toBe(false);
  });

  it("no baseline means nothing is committable, so nothing has changed", () => {
    // `dirty` already requires a baseline (no baseline → no concurrency base →
    // nothing safe to write), so this arm is unreachable through Save. Pinned
    // anyway: returning true here would open the panel-stays-open path for a save
    // that cannot happen.
    expect(scoringToggleChanged(draft(true), null)).toBe(false);
    expect(scoringToggleChanged(draft(true), undefined)).toBe(false);
  });
});
