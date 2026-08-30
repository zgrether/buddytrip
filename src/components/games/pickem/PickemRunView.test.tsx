import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemRunView, segmentStyle, type RunSlateGame } from "./PickemRunView";

/**
 * Screen E — results entry.
 *
 * The screen's job is to put the runner's remaining work at the top and get
 * everything else out of the way, so most of these are about what is in which
 * group and what is absent.
 */

const game = (over: Partial<RunSlateGame> & { id: string }): RunSlateGame => ({
  awayTeam: "Alabama",
  homeTeam: "Georgia",
  spread: null,
  kickoff: "Sat 3:30p",
  note: null,
  result: null,
  multiplier: 1,
  ...over,
});

const SLATE = [
  game({ id: "g1" }),
  game({ id: "g2", awayTeam: "Texas", homeTeam: "Oklahoma" }),
  game({ id: "g3", awayTeam: "LSU", homeTeam: "Ole Miss", result: "home" }),
];

const render = (over: Partial<Parameters<typeof PickemRunView>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemRunView
      slate={SLATE}
      canEdit
      busyId={null}
      ridingOn={new Map([["g1", 3]])}
      matchesPending={4}
      onSetResult={() => {}}
      {...over}
    />
  );

describe("two groups, because only one of them is work", () => {
  it("splits unmarked from entered, and heads only the second", () => {
    /**
     * The first group lost its "Needs a result · 2" eyebrow. A card carrying
     * four unpressed outcome buttons is self-evidently a game needing a result,
     * and the count it held was the same number the header shows two lines up.
     *
     * "Entered" keeps its eyebrow because that group is a change of SUBJECT —
     * the same slate, already dealt with — and without it the two groups read
     * as one list whose rows inexplicably change shape half way down.
     *
     * Asserted as an ORDER, which is the part that matters and the part an
     * eyebrow was only ever a proxy for: the work is above the record.
     */
    const html = render();
    expect(html).not.toContain("Needs a result");
    expect(html).toContain("Entered · 1");
    expect(html.indexOf('data-testid="pickem-run-row"')).toBeLessThan(
      html.indexOf("Entered ·")
    );
  });

  it("drops a group entirely rather than showing it empty", () => {
    // An empty group is a heading over nothing, and finishing is the best news
    // on the screen — it should read as finished, not as a section.
    const allIn = render({ slate: SLATE.map((g) => ({ ...g, result: "home" as const })) });
    expect(allIn).not.toContain('data-testid="pickem-run-row"');
    expect(allIn).toContain("Entered · 3");

    const noneIn = render({ slate: SLATE.map((g) => ({ ...g, result: null })) });
    expect(noneIn).toContain('data-testid="pickem-run-row"');
    expect(noneIn).not.toContain("Entered ·");
  });
});

describe("the four-segment control", () => {
  it("offers all four outcomes on an unmarked game", () => {
    const html = render();
    for (const v of ["away", "home", "push", "cancelled"]) {
      expect(html, v).toContain(`data-testid="pickem-run-${v}"`);
    }
  });

  it("paints a selected TEAM as accent and a selected Push or Void as neutral", () => {
    /**
     * Push and cancelled score identically to each other and are different
     * FACTS, but neither is a win. Painting them the way a team win is painted
     * would say a team did something.
     *
     * Asserted against the decision rather than the markup, because a selected
     * segment only appears on a REOPENED row and that is interaction state. The
     * component has no second copy of these values to drift from.
     *
     * The pair is the assertion — one selected style would satisfy either half
     * alone.
     */
    expect(segmentStyle("home", true).background).toBe("var(--color-bt-accent-faint)");
    expect(segmentStyle("away", true).color).toBe("var(--color-bt-accent)");

    expect(segmentStyle("push", true).background).toBe("var(--color-bt-hover)");
    expect(segmentStyle("cancelled", true).background).toBe("var(--color-bt-hover)");
    expect(segmentStyle("push", true).color).not.toBe("var(--color-bt-accent)");

    // Unselected is the same for all four — the distinction is about being
    // CHOSEN, not about what the segment is.
    for (const v of ["away", "home", "push", "cancelled"] as const) {
      expect(segmentStyle(v, false).background, v).toBe("transparent");
    }
  });

  it("reopens an entered game IN PLACE rather than making the runner clear it", () => {
    /**
     * Correcting a wrong result by clearing first passes through a state where
     * the game reads unplayed and every total on every other surface moves —
     * for a mistake being fixed in the same breath.
     *
     * The row is the control, so the reopen affordance has to be on it.
     */
    const html = render();
    expect(html).toContain('data-testid="pickem-run-reopen"');
    expect(html).toContain('data-open="false"');
    // Closed, it offers no outcome buttons and no clear — the line only.
    expect(html).not.toContain('data-testid="pickem-run-clear"');
  });

  it("shows a MEMBER the slate and none of the controls", () => {
    const html = render({ canEdit: false });
    expect(html).not.toContain('data-testid="pickem-run-away"');
    expect(html).not.toContain('data-testid="pickem-run-clear"');
    expect(html).not.toContain('data-testid="pickem-run-reopen"');
    // ...but the games are still there, so this is not passing by rendering
    // nothing.
    expect(html).toContain("Oklahoma");
    expect(html).toContain("Entered · 1");
  });
});

describe("what the screen says about its reader", () => {
  it("labels NOBODY — the RUNNER badge is gone from both sides", () => {
    /**
     * It named the READER on a screen the reader had chosen to open, from a tab
     * that already says "Enter results" in amber when there is work. A person
     * who can act arrives here knowing it, and every row repeats it with a live
     * control.
     *
     * Asserted for BOTH viewers, which is the point: as a runner-only badge its
     * absence for a member proved nothing about whether it had been removed —
     * that assertion passed for the whole of its life and would have gone on
     * passing after the badge was deleted.
     */
    for (const canEdit of [true, false]) {
      const html = render({ canEdit });
      expect(html, String(canEdit)).not.toContain('data-testid="pickem-run-runner-pill"');
      expect(html, String(canEdit)).not.toContain(">Runner<");
    }
  });

  it("badges a push as PUSHED, not as a sentence", () => {
    /**
     * It read "Push — nobody covered", which is an explanation where the three
     * other outcomes have a label. In a badge beside a row the em-dash clause
     * wraps, and the word doing the work is the first one anyway.
     *
     * Cancelled keeps its clause: "Cancelled" alone invites the reading that
     * somebody cancelled the ENTRY, and the fact worth carrying is that the
     * contest never happened.
     */
    const pushed = render({
      slate: SLATE.map((g, i) => ({ ...g, result: i === 0 ? ("push" as const) : null })),
    });
    expect(pushed).toContain("Pushed");
    expect(pushed).not.toContain("nobody covered");
  });
});

describe("what hangs on an unmarked game", () => {
  it("says how many matches are riding on it", () => {
    expect(render()).toContain("3 matches are still riding on this");
  });

  it("says nothing at all when the answer is none", () => {
    /**
     * Zero-because-nothing-hangs and zero-because-there-are-no-matches render
     * the same "0", and neither is worth a line. A team-totals game has no
     * matches at all, so the line would be a fact about a mechanic not in play.
     */
    const html = render({ ridingOn: new Map(), matchesPending: 0 });
    expect(html).not.toContain("riding on this");
    expect(html).not.toContain("hang on them");
  });

  it("agrees in number with itself, singular and plural", () => {
    const one = render({ ridingOn: new Map([["g1", 1]]) });
    expect(one).toContain("1 match is still riding on this");
    expect(one).not.toContain("1 matches");
  });

  it("declines to repeat what every other row is saying", () => {
    /**
     * Measured on the live slate: nine unmarked games, four live matches, and
     * every game read the same "4" — nine identical sentences carrying nothing
     * between them. A game drops below `matchesPending` only when some live
     * match has no stake on it — both sides on the same team at the same rank —
     * which is rare with distinct ranks across sixteen games.
     *
     * So the line earns its place when it is SURPRISING.
     *
     * The comparison used to be against a HEADER that said `matchesPending`
     * out loud; that line is gone, and the rule survives it unchanged because
     * the reason was never the header — it was the repetition.
     *
     * The pair is the assertion: same inputs but for the common number.
     */
    const uniform = render({ ridingOn: new Map([["g1", 4]]), matchesPending: 4 });
    expect(uniform).not.toContain("riding on this");

    const differs = render({ ridingOn: new Map([["g1", 2]]), matchesPending: 4 });
    expect(differs).toContain("2 matches are still riding on this");
  });

  it("tells the runner what the four buttons MEAN, in place of counting them", () => {
    /**
     * The header read "2 games still to mark · 4 matches hang on them". Both
     * halves were already on screen — the count is the "1/3" beside it and the
     * bar under it, and the unmarked games are the rows themselves.
     *
     * What was NOT on screen anywhere: that Push and Void are different facts,
     * and which of the two takes a game out of the scoring. Push/cancelled is
     * the distinction this whole surface is built around and the only one a
     * runner cannot work out from the buttons.
     */
    const html = render();
    expect(html).not.toContain("still to mark");
    expect(html).not.toContain("hang on them");
    expect(html).toContain("Mark the winner of the game");
    expect(html).toContain("mark it as void");
  });

  it("keeps the instructions away from a member", () => {
    // They are instructions for using controls a member does not have.
    expect(render({ canEdit: false })).not.toContain("Mark the winner");
  });
});

describe("progress", () => {
  it("reports a COUNT, and fills the track by it", () => {
    // "11 of 16 in", never "thru 11" — results land as games finish, and there
    // is no order to be eleven-deep into.
    const html = render();
    expect(html).toContain("1/3");
    expect(html).toContain("width:33.33333333333333%");
  });

  it("does not divide by an empty slate", () => {
    const html = render({ slate: [] });
    expect(html).toContain("0/0");
    expect(html).toContain("width:0%");
    expect(html).not.toContain("NaN");
  });
});
