import fs from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemNoMatches, noMatchesDrawn } from "./PickemNoMatches";

/**
 * Locked and unpaired — a normal state, and the cases here are all about it not
 * being dressed as a broken one.
 */

const render = (canDraw = false) => renderToStaticMarkup(<PickemNoMatches canDraw={canDraw} />);
const WAIT = "Check back later to see who your opponent is.";

describe("PickemNoMatches", () => {
  it("tells a member what they are waiting for, and stops", () => {
    const html = render(false);
    expect(html).toContain("No matches drawn yet");
    expect(html).toContain(WAIT);
  });

  it("does NOT tell the runner to wait — they are the one everyone is waiting on", () => {
    // Zach's look (2026-09-23). Both arms asserted: a build that drops the
    // line for everyone fails the member case above; one that ignores
    // `canDraw` fails this one.
    const html = render(true);
    expect(html).toContain("No matches drawn yet");
    expect(html).not.toContain(WAIT);
  });

  it("is DASHED, because there will be something here", () => {
    // A solid card says "here is the thing"; a dashed one says "this is where
    // it will appear". The distinction is the whole reason waiting reads as
    // waiting rather than as an empty list.
    expect(render()).toContain("dashed");
  });

  it("sends nobody to settings — runner or member", () => {
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
     * This used to also assert the component took NO props — "there is nothing
     * to branch on". It branches now, on one line: the runner is not told to
     * wait (Zach, 2026-09-23). What that assertion protected — no route to
     * settings for anyone — is asserted directly instead, for both viewers.
     */
    for (const html of [render(false), render(true)]) {
      expect(html).not.toContain("game settings");
      expect(html).not.toContain("gear");
      expect(html).not.toContain('data-testid="pickem-no-matches-settings"');
    }
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

  it("the Matches tab asks the SAME runner question as the strip", () => {
    // `tsc` forces `canDraw` to be passed, not what it is passed. `runnerStrip`
    // is the flag that mounts the strip saying "draw the matches"; anything
    // else lets the two disagree about who the runner is — a runner told to
    // wait by the tab while the strip tells them to act.
    expect(SRC).toContain("<PickemNoMatches canDraw={runnerStrip} />");
  });

  it("nothing in the results panel keys on the matches prerequisite", () => {
    const region = SRC.slice(start, end);
    expect(region.includes("noMatchesDrawn")).toBe(false);
    expect(region.includes("MatchesRequired")).toBe(false);
  });
});
