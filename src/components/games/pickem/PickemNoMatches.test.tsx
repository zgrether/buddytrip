import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemNoMatches } from "./PickemNoMatches";

/**
 * Locked and unpaired — a normal state, and the cases here are all about it not
 * being dressed as a broken one.
 */

const render = () => renderToStaticMarkup(<PickemNoMatches />);

describe("PickemNoMatches", () => {
  it("tells everyone what they are waiting for, and stops", () => {
    const html = render();
    expect(html).toContain("No matches drawn yet");
    expect(html).toContain("Check back later to see who your opponent is.");
  });

  it("is DASHED, because there will be something here", () => {
    // A solid card says "here is the thing"; a dashed one says "this is where
    // it will appear". The distinction is the whole reason waiting reads as
    // waiting rather than as an empty list.
    expect(render()).toContain("dashed");
  });

  it("sends nobody to settings, and takes no viewer at all", () => {
    /**
     * There was a second card here for the runner — "Matches can be set in the
     * game settings", with a chevron. It is gone and nothing replaced it.
     *
     * It duplicated a route the header gear already provides on every format,
     * and it sat INSIDE the matches tab: a signpost to somewhere else, printed
     * on the surface a runner had just chosen to open. The tab is the answer to
     * "where are the matches"; a card explaining they live elsewhere is the
     * screen apologising for itself.
     *
     * The component takes no props now, which is the strongest form of "it says
     * the same thing to everyone" — there is nothing to branch on.
     */
    const html = render();
    expect(html).not.toContain("game settings");
    expect(html).not.toContain('data-testid="pickem-no-matches-settings"');
    expect(PickemNoMatches.length).toBe(0);
  });
});
