import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemNoMatches } from "./PickemNoMatches";

/**
 * Locked and unpaired — a normal state, and the cases here are all about it not
 * being dressed as a broken one.
 */

const render = (over: Partial<Parameters<typeof PickemNoMatches>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemNoMatches canEdit={false} onOpenSettings={() => {}} {...over} />
  );

describe("PickemNoMatches", () => {
  it("tells a member what they are waiting for, and stops", () => {
    const html = render();
    expect(html).toContain("No matches drawn yet");
    expect(html).toContain("Check back later to see who your opponent is.");
    // No instruction — a member cannot pair, and naming an action they have no
    // control for is the refusal-with-nowhere-to-go shape this feature has
    // already produced twice.
    expect(html).not.toContain("settings");
  });

  it("is DASHED, because there will be something here", () => {
    // A solid card says "here is the thing"; a dashed one says "this is where
    // it will appear". The distinction is the whole reason waiting reads as
    // waiting rather than as an empty list.
    expect(render()).toContain("dashed");
  });

  it("gives the runner the way through — and never a warning", () => {
    /**
     * Pairing after the lock is a legitimate workflow: a runner may well draw
     * the matches once they can see who actually submitted. Amber would make
     * that look like a mistake, so this is a plain card with an accent badge.
     */
    const html = render({ canEdit: true });
    expect(html).toContain("Matches can be set in the game settings");
    expect(html).toContain('data-testid="pickem-no-matches-settings"');
    expect(html).not.toContain("--color-bt-warning-faint");
    expect(html).not.toContain("--color-bt-owner");
  });

  it("offers nothing to press when there is nothing to press", () => {
    // A runner reading this on a surface with no settings route would be sent
    // somewhere that is not there. Absent, not disabled.
    expect(render({ canEdit: true, onOpenSettings: undefined })).not.toContain(
      'data-testid="pickem-no-matches-settings"'
    );
  });
});
