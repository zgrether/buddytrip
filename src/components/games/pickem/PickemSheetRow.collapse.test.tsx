import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheetRow } from "./PickemSheetRow";

/**
 * The picks row opens, and a shut row still says what you took.
 *
 * ── WHAT THIS FILE CANNOT SEE, stated rather than implied ─────────────────
 *
 * The suite is `environment: "node"` with no DOM and no testing-library, so
 * everything here is the FIRST render's markup. Three things in this feature
 * are therefore out of reach and are not covered by anything below:
 *
 *   - the 400ms hold and the close that follows it (a timer)
 *   - that clearing a pick leaves the row OPEN while choosing one closes it
 *   - that the collapse actually animates rather than jumping
 *
 * The first two are behaviour, and the third is a running browser's business.
 * What IS pinned here is the part a wrong build gets wrong silently: that the
 * body is MOUNTED while shut (so there is something to animate), that it is
 * shut to begin with, and that the pick survives the row being shut. A file
 * that states its limit is worth more than one implying coverage it lacks.
 */

const GAME = {
  id: "g1",
  awayTeam: "Milwaukee Brewers",
  homeTeam: "Cincinnati Reds",
  spread: null,
  multiplier: 1,
  kickoff: "Fri Sep 4, 6:10p",
  note: null,
};

const render = (over: Partial<Parameters<typeof PickemSheetRow>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemSheetRow
      game={GAME}
      pick={null}
      points={null}
      editable
      onPick={() => {}}
      {...over}
    />
  );

/** One element's opening tag, found by testid. */
function tag(markup: string, testId: string): string {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at === -1) return "";
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

describe("a picks row starts shut", () => {
  it("renders collapsed", () => {
    expect(tag(render(), "pickem-card-body")).toContain('data-open="false"');
  });

  it("keeps the control MOUNTED while shut, so it has something to animate", () => {
    /**
     * THE MUTATION: `{open && children}` instead of the collapsing container.
     *
     * That build renders a row that is closed, opens on a tap, and passes any
     * test asking "is it collapsed by default" — while having no closing frame
     * at all. The 400ms hold would then be four-tenths of a second of nothing
     * followed by the control vanishing between frames, which is precisely the
     * failure the hold exists to prevent.
     *
     * So: the segments must be IN the markup of a shut row, and the body must
     * carry a height transition rather than being hidden outright.
     */
    const shut = render();
    expect(shut).toContain('data-testid="pickem-pick-away"');

    const body = tag(shut, "pickem-card-body");
    expect(body).toContain("max-height:0");
    expect(body).toContain("transition");
    expect(body).toContain("280ms");
    // Hidden by HEIGHT, not by `display`, which cannot be transitioned.
    expect(body).not.toContain("display:none");
  });

  it("announces itself as a disclosure", () => {
    const header = tag(render(), "pickem-sheet-disclosure");
    expect(header).toContain('aria-expanded="false"');
    // ...and the control it hides is not offered to a screen reader while the
    // sighted reader cannot see it.
    expect(tag(render(), "pickem-card-body")).toContain('aria-hidden="true"');
  });
});

describe("a locked row does not open", () => {
  it("has no disclosure at all once picks are closed", () => {
    /**
     * THE MUTATION: leave `onHeaderTap` wired regardless of `editable`.
     *
     * That build looks fine and IS fine until you tap: the row opens onto two
     * `disabled` buttons. A gesture that costs a tap to discover there is
     * nothing behind it is worse than a row that does not move at all, which is
     * what was reported from the device.
     *
     * Asserted as the ABSENCE of the tap target rather than as "the body stays
     * shut", because a build that kept the button and ignored the click would
     * pass the second and still show a pressable header.
     */
    const locked = render({ editable: false, pick: "home", outcome: "lost" });
    expect(locked).not.toContain('data-testid="pickem-sheet-disclosure"');
    expect(locked).not.toContain("aria-expanded");

    // ...and the editable sheet still has one, so this is not passing by the
    // disclosure having been deleted outright.
    expect(render()).toContain('data-testid="pickem-sheet-disclosure"');
  });

  it("still shows the locked pick, so nothing is hidden by refusing to open", () => {
    /**
     * The refusal is only honest because the accent on the chosen side's name
     * survives it. Without this pair, "don't open when locked" would be a way
     * of hiding the answer on the one sheet that exists to show it.
     */
    const locked = render({ editable: false, pick: "home", outcome: "lost" });
    expect(tag(locked, "pickem-matchup-home")).toContain("--color-bt-accent)");
  });
});

describe("a shut row still says what you took", () => {
  it("accents the CHOSEN side's name and leaves the other alone", () => {
    /**
     * This is what makes collapsing-by-default honest instead of hiding the
     * answer: a sixteen-row sheet reads straight down with nothing open.
     *
     * Anchored per LINE. The team names also appear on the segments inside the
     * body, so a document-wide search for the accent would be satisfied by the
     * selected segment — which is present in the markup even while shut, and
     * means something different.
     */
    const away = render({ pick: "away" });
    expect(tag(away, "pickem-matchup-away")).toContain("--color-bt-accent)");
    expect(tag(away, "pickem-matchup-home")).not.toContain("--color-bt-accent)");

    const home = render({ pick: "home" });
    expect(tag(home, "pickem-matchup-home")).toContain("--color-bt-accent)");
    expect(tag(home, "pickem-matchup-away")).not.toContain("--color-bt-accent)");
  });

  it("accents NEITHER name on a row nobody has picked", () => {
    /**
     * The mutation this catches: accenting by side rather than by pick — e.g.
     * always painting the home team, which is what the picker defaults to. An
     * unpicked row would then read as a pick, on the one screen where the
     * difference between "I took the chalk" and "I never chose" is the whole
     * subject.
     */
    const none = render({ pick: null });
    expect(tag(none, "pickem-matchup-away")).not.toContain("--color-bt-accent)");
    expect(tag(none, "pickem-matchup-home")).not.toContain("--color-bt-accent)");
  });
});
