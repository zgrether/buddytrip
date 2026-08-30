import fs from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMatchesRequired, noMatchesDrawn } from "./PickemMatchesRequired";

/**
 * r7 §11 — the prerequisite, said before the door shuts.
 *
 * Migration 162 freezes `save_pickem_matches` on the first result. A runner who
 * enters results before drawing matches then meets a refusal naming a rule they
 * can no longer satisfy, which is exactly the shape CLAUDE.md's refusal rule is
 * about.
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
    // The control. Without it "fires" is satisfied by a predicate that never
    // clears, which would scrim the results page for the whole game.
    expect(noMatchesDrawn(input({ matchCount: 1 }))).toBe(false);
  });

  it("NEVER fires where matches are not the roll-up — nothing to draw", () => {
    /**
     * Team totals has zero matches forever and correctly needs none, so a
     * length-only build covers its results page permanently with a panel naming
     * a mechanic that game does not have. Points mode reaches the same answer,
     * through the same flag.
     */
    expect(noMatchesDrawn(input({ individualMatches: false }))).toBe(false);
  });

  /**
   * ── WHAT THIS DOES NOT TEST, AND WHY IT LOOKS LIKE COVERAGE ──────────────
   *
   * An earlier version took `rollUp` and `pointsMode` and resolved the override
   * here, with cases pinning that a points cup carrying `individual_matches` is
   * not treated as match play. Those cases were real and they are gone, because
   * the resolution is gone: `pickemRollUpOverride.test.ts` refuses a sixth site
   * comparing the raw column, and it is right to — Phase 7 found five and four
   * were bugs.
   *
   * So "is this game match play" is answered ONCE, in
   * `PickemGameView.individualMatches`, and that file's allowlist entry is what
   * pins the ordering now. Nothing here re-decides it. Said out loud because the
   * case above reads like it covers team totals and it does not: it covers a
   * flag being respected, which is all this function does.
   */
});

describe("the scrim itself", () => {
  const html = renderToStaticMarkup(<PickemMatchesRequired />);

  it("gives the REASON, not just the rule", () => {
    // "You can't yet" invites the runner to try the other order. The freeze is
    // why there is only one order, and it is the half they cannot infer.
    expect(html).toContain("freezes the pairings");
  });

  it("names somewhere the reader can actually go", () => {
    /**
     * A refusal has to point at something reachable from where the person is
     * standing — the rule two of this feature's messages have already broken by
     * naming an object or a screen that was not there.
     */
    expect(html).toContain("The gear at the top of this page, then Matches.");
  });

  it("covers rather than replaces — it is positioned over its surface", () => {
    // The slate stays visible underneath. `absolute inset-0` is the whole
    // difference between "not yet" and "there is nothing here".
    expect(html).toContain("absolute inset-0");
  });

  it("does not centre itself vertically", () => {
    /**
     * The list behind it is as long as the slate, so a centred panel on a
     * sixteen-game page is below the fold on a phone — the reader would meet an
     * inert screen with no explanation on it until they scrolled.
     *
     * Asserted as the absence of the centring class rather than the presence of
     * a top offset: `items-center` is what a later tidy-up would add back.
     */
    expect(html).not.toContain("items-center rounded-xl");
    expect(html).toContain("h-fit");
  });
});

/**
 * ── SOURCE GUARD: the scrim is actually mounted, over the results ──────────
 *
 * Everything above renders the component directly, so all of it passes against
 * a build where `PickemGameView` never mounts it — and the results page would
 * then look exactly as it did before, which is the state §11 exists to change.
 *
 * `PickemGameView` is a 2000-line client component full of hooks and tRPC; this
 * suite is `environment: "node"` and cannot mount it. A source guard is what is
 * available, and it says so rather than implying behavioural cover.
 */
describe("the view mounts it over the results panel (source)", () => {
  const SRC = fs.readFileSync(join(__dirname, "..", "PickemGameView.tsx"), "utf8");

  it("the scan can see the surface at all — not passing on a moved file", () => {
    expect(SRC).toContain("PickemRunView");
  });

  it("renders the scrim, and inside a positioned wrapper", () => {
    /**
     * `absolute inset-0` resolves against the nearest positioned ancestor. With
     * no `relative` wrapper the scrim escapes to the page and covers the whole
     * app — a failure that looks nothing like a missing scrim and everything
     * like a broken build.
     */
    expect(SRC).toContain("{noMatchesDrawn && <PickemMatchesRequired />}");
    const at = SRC.indexOf("{noMatchesDrawn && <PickemMatchesRequired />}");

    // The NEAREST positioned wrapper before it, not merely some wrapper
    // somewhere above. A plain `toContain` over everything up to here passes
    // the moment any unrelated `relative` div is added higher in a 2000-line
    // file, and the scrim would then be escaping to the page while the guard
    // stayed green.
    const wrapper = SRC.lastIndexOf('<div className="relative">', at);
    expect(wrapper, "no positioned wrapper before the scrim").toBeGreaterThan(-1);

    // `lastIndexOf` makes this the NEAREST wrapper by construction, so what
    // sits between the two is what the scrim resolves against.
    expect(SRC.slice(wrapper, at)).toContain("<PickemRunView");
  });

  it("both surfaces read the SAME predicate", () => {
    // The Matches tab's waiting panel and this scrim answer one question. Two
    // spellings is how one covers a game the other calls ready.
    expect(SRC.split("noMatchesDrawn").length - 1).toBeGreaterThanOrEqual(3);
    expect(SRC).toContain("noMatchesDrawnFor({");
  });

  it("hands it the RESOLVED flag, not the raw column", () => {
    /**
     * `pickem_games.roll_up` is inert in a points competition but still set, so
     * a raw comparison renders match-play behaviour in a cup with no matches —
     * the failure `pickemRollUpOverride.test.ts` exists to catch, which caught
     * this function's first draft.
     *
     * That guard scans every non-test file, so it already refuses a raw read
     * inside `PickemMatchesRequired.tsx`. What it cannot see is the CALL: this
     * file passing `q.data.settings.rollUp` straight through would satisfy it
     * (the comparison would live on the allowlisted side) while putting the
     * unresolved value back into the predicate.
     */
    const at = SRC.indexOf("noMatchesDrawnFor({");
    const call = SRC.slice(at, SRC.indexOf("});", at));
    expect(call).toContain("individualMatches");
    expect(call).not.toContain("rollUp");
    expect(call).not.toContain("pointsMode");
  });
});
