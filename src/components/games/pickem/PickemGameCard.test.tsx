import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemGameCard, PickemSegments, segmentStyle, SETTLED_DIM } from "./PickemGameCard";
import { MatchupLine } from "./slateRowVisual";
import { PickemSheetRow } from "./PickemSheetRow";
import { PickemRunView } from "./PickemRunView";

/**
 * r7 §12 — one card, three surfaces.
 *
 * The picks sheet, the results page and the slate modal each drew the same
 * contest in their own arrangement. Nothing was wrong with any one of them; the
 * cost was that a person moving between the tabs re-parsed the same row.
 */

const GAME = {
  awayTeam: "Alabama",
  homeTeam: "Georgia",
  spread: "-3.5",
  kickoff: "Sat Nov 8, 7:30p",
  note: "Night game",
  multiplier: 2,
};

describe("the matchup line", () => {
  const html = renderToStaticMarkup(<MatchupLine game={GAME} />);

  it("pins the multiplier RIGHT, past a spacer", () => {
    /**
     * It used to follow the spread inside a wrapping run, so its x position
     * moved with the length of the team names and with whether the game had a
     * line at all — sixteen places to find the one badge that changes how you
     * spend confidence.
     *
     * The spacer is what pins it. Asserted as ORDER rather than as the presence
     * of a class: the badge must come after the flex filler, and the spread
     * before it.
     */
    const spread = html.indexOf("-3.5");
    const spacer = html.indexOf('class="flex-1"');
    const badge = html.indexOf("pickem-multiplier-badge");
    expect(spread).toBeGreaterThan(-1);
    expect(spacer).toBeGreaterThan(spread);
    expect(badge).toBeGreaterThan(spacer);
  });

  it("does not WRAP — a long matchup truncates instead", () => {
    /**
     * Wrapping is what let a long matchup push the badge onto a second line,
     * which is the divergence §12 is about: one line here and two there for the
     * same game. Asserted on the line's own class list rather than the page,
     * because the card around it legitimately stacks.
     */
    expect(html).not.toContain("flex-wrap");
    expect(html).toContain("truncate");
  });

  it("keeps the spread WITH the home team", () => {
    // The one badge whose position is meaningful rather than tidy: the line
    // belongs to the home side, so it sits at that end of the matchup.
    const home = html.indexOf("Georgia");
    expect(html.indexOf("-3.5")).toBeGreaterThan(home);
  });
});

describe("the card", () => {
  const render = (over: Partial<Parameters<typeof PickemGameCard>[0]> = {}) =>
    renderToStaticMarkup(
      <PickemGameCard game={GAME} testId="card" {...over} />
    );

  it("fades a settled card's CONTENT and keeps its surface", () => {
    // The stripe and border say "2× game" and stay true when the game is over.
    const html = render({ settled: true });
    expect(html).toContain(`opacity:${SETTLED_DIM}`);
    expect(html).toContain("var(--color-bt-glorious)");
  });

  it("renders the BADGE outside the fade", () => {
    /**
     * The §12 half that is not about layout. CSS opacity MULTIPLIES, so a stamp
     * inside a faded subtree cannot be made legible from the inside whatever
     * you set on it — and every row that carries `NOT PICKED` is settled, so the
     * label was at 38% on 100% of the rows that had one.
     *
     * Asserted by POSITION: the badge's markup must fall after the dimmed
     * content closes, not within it. A build that merely sets a higher opacity
     * on the badge passes any "is it dim" check and still renders it at 38%.
     */
    const html = render({ settled: true, badge: <b data-testid="stamp">NOT PICKED</b> });

    /**
     * ── THE FIRST VERSION OF THIS WAS DECORATIVE, AND A MUTATION SAID SO ────
     *
     * It looked for the first `</div>` after the dim and required the stamp to
     * come later. That closing tag belongs to `MatchupLine`'s own div, which
     * closes before the badge either way — so moving the badge INSIDE the faded
     * wrapper passed it. The check was measuring a region next to the one the
     * claim was about.
     *
     * This walks the tags instead, so "inside" means inside.
     */
    const open = html.indexOf('data-testid="pickem-card-content"');
    expect(open, "the dimmed wrapper is not there to check").toBeGreaterThan(-1);
    expect(html.slice(0, open)).toContain(`opacity:${SETTLED_DIM}`);

    // Balance from the wrapper's own opening tag to find where it closes.
    let depth = 0;
    let i = html.lastIndexOf("<div", open);
    let end = -1;
    while (i > -1 && i < html.length) {
      const nextOpen = html.indexOf("<div", i + 1);
      const nextClose = html.indexOf("</div>", i + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen;
      } else if (depth === 0) {
        end = nextClose;
        break;
      } else {
        depth -= 1;
        i = nextClose;
      }
    }
    expect(end, "could not find the wrapper's closing tag").toBeGreaterThan(open);

    const stampAt = html.indexOf('data-testid="stamp"');
    expect(stampAt, "the stamp did not render at all").toBeGreaterThan(-1);
    expect(stampAt, "the stamp is INSIDE the faded wrapper").toBeGreaterThan(end);
  });

  it("fades nothing when the card is live", () => {
    // The control. Without it "fades a settled card" is satisfied by one that
    // is always dim.
    expect(render({ settled: false })).not.toContain(`opacity:${SETTLED_DIM}`);
  });
});

describe("the segments", () => {
  const render = (over: Partial<Parameters<typeof PickemSegments>[0]> = {}) =>
    renderToStaticMarkup(
      <PickemSegments
        values={["away", "home", "push", "cancelled"] as const}
        awayTeam="Alabama"
        homeTeam="Georgia"
        selected={null}
        onSelect={() => {}}
        testIdPrefix="t"
        {...over}
      />
    );

  it("offers TWO on the picks version and four on the results one", () => {
    const four = render();
    for (const v of ["away", "home", "push", "cancelled"]) {
      expect(four).toContain(`data-testid="t-${v}"`);
    }
    const two = render({ values: ["away", "home"] as const });
    expect(two).toContain('data-testid="t-away"');
    expect(two).toContain('data-testid="t-home"');
    expect(two).not.toContain('data-testid="t-push"');
    expect(two).not.toContain('data-testid="t-cancelled"');
  });

  it("splits evenly with two values and reserves the short columns with four", () => {
    // Push and Void are short fixed words; the teams take what is left. With
    // only two values there is nothing to reserve for.
    expect(render()).toContain("1fr 1fr 52px 52px");
    expect(render({ values: ["away", "home"] as const })).toContain("grid-template-columns:1fr 1fr");
  });

  it("paints a chosen TEAM in accent and a chosen Push/Void neutrally", () => {
    // Push and cancelled score identically and are different facts, but neither
    // is a win — painting them as a team win would say a team did something.
    expect(segmentStyle("home", true).background).toBe("var(--color-bt-accent-faint)");
    expect(segmentStyle("push", true).background).toBe("var(--color-bt-hover)");
    expect(segmentStyle("push", true).color).not.toBe("var(--color-bt-accent)");
    for (const v of ["away", "home", "push", "cancelled"] as const) {
      expect(segmentStyle(v, false).background, v).toBe("transparent");
    }
  });

  it("marks the selected segment for both the DOM and the a11y tree", () => {
    const html = render({ selected: "home" });
    const tag = html.slice(html.indexOf('data-testid="t-home"'));
    expect(tag.slice(0, tag.indexOf(">"))).toContain('data-selected="true"');
    expect(tag.slice(0, tag.indexOf(">"))).toContain('aria-pressed="true"');
  });

  it("does not FADE a read-only control — only a saving one", () => {
    /**
     * A locked sheet disables its segments, and fading them would put the whole
     * answer behind a treatment that means "wait" — including the segment
     * carrying the pick, which is the one thing a locked sheet exists to show.
     */
    const readOnly = render({ disabled: true, selected: "home" });
    expect(readOnly).toContain("disabled=");
    expect(readOnly).not.toContain("disabled:opacity-40");
    // ...and a saving control DOES fade, so this is a distinction and not a
    // build that never fades anything.
    expect(render({ busy: true })).toContain("disabled:opacity-40");
  });
});

/**
 * ── THE ACTUAL §12 ASSERTION ──────────────────────────────────────────────
 *
 * Everything above tests the shared pieces. None of it can see whether the two
 * surfaces USE them — and "three files that each look right" is precisely the
 * state §12 was called on.
 *
 * So: render the same contest through both, and require the matchup line to be
 * byte-identical. It is built by rendering `MatchupLine` directly, so the
 * expected value is not a transcription of either surface's output — a fragment
 * copied from one of them would pass against that one forever.
 */
describe("the sheet and the results page draw the same contest identically", () => {
  const SAME = {
    id: "g1",
    awayTeam: "Alabama",
    homeTeam: "Georgia",
    spread: "-3.5",
    kickoff: "Sat Nov 8, 7:30p",
    note: "Night game",
    multiplier: 2,
  };

  /** The fragment both surfaces must contain, built from the shared component. */
  const expected = renderToStaticMarkup(<MatchupLine game={SAME} />);

  const sheet = renderToStaticMarkup(
    <PickemSheetRow
      game={SAME}
      pick={null}
      /* No rank chip, so the two are comparable: the chip is a `leading` slot
         and legitimately differs — the sheet numbers its rows and the results
         page does not. */
      points={null}
      editable
      onPick={() => {}}
    />
  );

  const results = renderToStaticMarkup(
    <PickemRunView
      slate={[{ ...SAME, result: null }]}
      canEdit
      busyId={null}
      onSetResult={() => {}}
    />
  );

  it("the sheet renders the shared matchup line", () => {
    expect(sheet).toContain(expected);
  });

  it("the results page renders the same one", () => {
    expect(results).toContain(expected);
  });

  it("and the fragment is not trivially empty", () => {
    // Absence of matches is absence of search: if `MatchupLine` ever rendered
    // nothing, both cases above would pass against anything at all.
    expect(expected).toContain("Alabama");
    expect(expected).toContain("Georgia");
    expect(expected).toContain("-3.5");
    expect(expected).toContain("Sat Nov 8, 7:30p · Night game");
    expect(expected.length).toBeGreaterThan(200);
  });

  it("both put their control BELOW the matchup, in the same shape", () => {
    // Line 3. The values differ — a picker takes a side, a runner marks an
    // outcome — and everything else about the control does not.
    expect(sheet.indexOf('data-testid="pickem-pick-away"')).toBeGreaterThan(sheet.indexOf(expected));
    expect(results.indexOf('data-testid="pickem-run-away"')).toBeGreaterThan(
      results.indexOf(expected)
    );
    expect(sheet).not.toContain("pickem-pick-push");
    expect(results).toContain("pickem-run-push");
  });
});
