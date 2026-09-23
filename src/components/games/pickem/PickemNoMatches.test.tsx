import fs from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemNoMatches, noMatchesDrawn } from "./PickemNoMatches";

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

/**
 * The predicate, moved here with its only remaining surface (results-first PR).
 * The scrim it used to gate over the RESULTS panel is gone — see
 * `noMatchesDrawn`'s comment — and the guard at the bottom pins that it stays
 * gone.
 */
describe("noMatchesDrawn", () => {
  const input = (over: Partial<Parameters<typeof noMatchesDrawn>[0]> = {}) => ({
    individualMatches: true,
    matchCount: 0,
    ...over,
  });

  it("fires on an individual-matches game with nobody drawn", () => {
    expect(noMatchesDrawn(input())).toBe(true);
  });

  it("stops the moment one match exists", () => {
    // The control: without it "fires" is satisfied by a predicate that never clears.
    expect(noMatchesDrawn(input({ matchCount: 1 }))).toBe(false);
  });

  it("NEVER fires where matches are not the roll-up — nothing to draw", () => {
    // Team totals has zero matches forever and correctly needs none. Points mode
    // reaches the same answer through the same RESOLVED flag.
    expect(noMatchesDrawn(input({ individualMatches: false }))).toBe(false);
  });
});

describe("results are entered whenever they happen (results-first PR)", () => {
  /**
   * The results panel must not be gated on the matches prerequisite. A slate
   * result is a real-world fact — it happened whether or not anyone drew a
   * match over it — and a pick'em pairing stores nothing a later draw could
   * invalidate, so a block there guards nothing (Zach, 2026-09-23).
   *
   * Scoped to the RESULTS PANEL'S SOURCE REGION, from its panel condition to the
   * next panel's, because `noMatchesDrawn` legitimately appears elsewhere in the
   * view (the Matches tab and the runner's strip). A whole-file scan would be
   * satisfied by those — the substring corollary's SCOPE form.
   */
  const SRC = fs.readFileSync(join(__dirname, "..", "PickemGameView.tsx"), "utf8");
  const start = SRC.indexOf('surface.panel === "results"');
  const end = SRC.indexOf('surface.panel === "matches"', start + 1);

  it("the scan can see the region at all — not passing on a moved panel", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("nothing in the results panel keys on the matches prerequisite", () => {
    const region = SRC.slice(start, end);
    expect(region.includes("noMatchesDrawn")).toBe(false);
    expect(region.includes("MatchesRequired")).toBe(false);
  });
});
