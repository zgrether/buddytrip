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

  /** One element's opening tag, found by testid — anchored to the LINE rather
   *  than searched for in a document that repeats team names below. */
  const tag = (markup: string, testId: string) => {
    const at = markup.indexOf(`data-testid="${testId}"`);
    if (at === -1) return "";
    return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
  };

  it("gives each team its OWN line — two, always, whatever the names are", () => {
    /**
     * This REPLACES "does not WRAP — a long matchup truncates instead", which
     * asserted the r7 §12 arrangement this reverses. That test would still pass
     * against the current build (there is no `flex-wrap` and there is a
     * `truncate`), which is exactly why it had to go rather than be kept as a
     * bonus: its NAME claims a single-line matchup, the code no longer renders
     * one, and a test whose name describes a path it does not take is worse
     * than no test.
     *
     * The mechanism is that the two names live in SEPARATE elements. The old
     * build held both inside one span with an "at" between them, so the away
     * line containing the home team's name is the precise signature of the
     * arrangement being reversed.
     */
    const away = tag(html, "pickem-matchup-away");
    const home = tag(html, "pickem-matchup-home");
    expect(away).not.toBe("");
    expect(home).not.toBe("");

    // Two elements, not one — and the away line is not secretly the whole
    // matchup. Sliced to the away element's own text, so the home team
    // appearing anywhere else in the document cannot satisfy this.
    const awayStart = html.indexOf('data-testid="pickem-matchup-away"');
    const awayText = html.slice(awayStart, html.indexOf("</span>", awayStart));
    expect(awayText).toContain("Alabama");
    expect(awayText).not.toContain("Georgia");

    // Each line holds itself to ONE line, so a long name cannot make a third.
    expect(away).toContain("truncate");
    expect(home).toContain("truncate");
  });

  it("pins the multiplier out of the text flow, so names cannot move it", () => {
    /**
     * §12's goal kept, its mechanism replaced. The badge used to be the end of
     * a flex run after a `flex-1` spacer, which pinned it right but left it
     * INSIDE the line — so it competed with the names for width. It is now
     * absolute, and the names pad to clear it.
     *
     * The clearance is the half worth asserting: a build that positions the
     * badge absolutely and forgets the padding renders the badge ON TOP of a
     * long team name, which looks fine on "Alabama" and breaks on
     * "Lebanon Valley Flying Dutchmen".
     */
    expect(tag(html, "pickem-matchup-multiplier-slot")).toContain("right:0");
    expect(tag(html, "pickem-matchup-away")).toContain("padding-right:44px");
    expect(tag(html, "pickem-matchup-home")).toContain("padding-right:44px");
  });

  it("does not pay for clearance on a game that has no multiplier", () => {
    /**
     * The mutation this exists for: making the padding unconditional. Every
     * assertion above still passes, and every 1x row — which is most of a slate
     * — silently loses 44px of name it had no reason to.
     */
    const plain = renderToStaticMarkup(<MatchupLine game={{ ...GAME, multiplier: 1 }} />);
    expect(plain).not.toContain("pickem-matchup-multiplier-slot");
    expect(tag(plain, "pickem-matchup-away")).not.toContain("padding-right");
    expect(tag(plain, "pickem-matchup-home")).not.toContain("padding-right");
  });

  it("keeps the spread WITH the home team", () => {
    // The one badge whose position is meaningful rather than tidy: the line
    // belongs to the home side, so it sits on that line — which is now a
    // stronger claim than "after it in the markup", because the away team has
    // its own line for the spread to be absent from.
    const homeStart = html.indexOf('data-testid="pickem-matchup-home"');
    const awayStart = html.indexOf('data-testid="pickem-matchup-away"');
    const spread = html.indexOf("-3.5");
    expect(spread).toBeGreaterThan(homeStart);
    expect(homeStart).toBeGreaterThan(awayStart);
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

  it("gives the TEAMS a full-width row and drops the outcomes beneath", () => {
    /**
     * This REPLACES "splits evenly with two values and reserves the short
     * columns with four", which asserted `1fr 1fr 52px 52px`.
     *
     * That layout is the reported truncation. At 390px the card's content box
     * is ~340px, so 104px of fixed columns plus gaps left each team ~115px —
     * enough for "Toledo", not for "Michigan State Spartans". The teams now
     * take a row of their own.
     *
     * Asserted as the ABSENCE of the fixed columns plus the presence of a
     * second row, rather than on the grid string alone: a build that kept the
     * four in one row and merely restyled them would still satisfy a
     * `toContain("1fr 1fr")`, since the teams' own row uses exactly that.
     */
    const four = render();
    expect(four).not.toContain("52px");

    // The outcomes are in their own `col-span-2` sub-grid — the structural
    // signature of "second row", which a single flat grid cannot produce.
    expect(four).toContain("col-span-2");

    // ...and the two teams still split their row evenly.
    expect(four).toContain("grid-template-columns:1fr 1fr");
  });

  it("leaves a TWO-value control as one row — the sheet is not the results page", () => {
    /**
     * The mutation this exists for: applying the second row unconditionally.
     * Every assertion above still passes, and the picks sheet — which has no
     * outcomes to put in a second row — grows an empty one.
     */
    const two = render({ values: ["away", "home"] as const });
    expect(two).toContain("grid-template-columns:1fr 1fr");
    expect(two).not.toContain("col-span-2");
  });

  it("makes the outcomes SECONDARY, not equal siblings of the teams", () => {
    /**
     * Push and Cancelled are rare; a control whose common case is visually
     * primary reads faster than four equal buttons. `segmentStyle` already
     * said this in colour and now the size says it too — one statement, twice,
     * rather than two.
     *
     * Anchored per-BUTTON via testid. A document-wide `toContain("30px")`
     * would be satisfied by any other 30px in the card, which is the substring
     * corollary exactly.
     */
    const four = render();
    const tagFor = (v: string) => {
      const at = four.indexOf(`data-testid="t-${v}"`);
      return four.slice(four.lastIndexOf("<", at), four.indexOf(">", at) + 1);
    };
    expect(tagFor("away")).toContain("height:34px");
    expect(tagFor("home")).toContain("height:34px");
    expect(tagFor("push")).toContain("height:30px");
    expect(tagFor("cancelled")).toContain("height:30px");
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
