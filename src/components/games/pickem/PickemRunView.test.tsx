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
      blockedReason={null}
      ridingOn={new Map([["g1", 3]])}
      matchesPending={4}
      onSetResult={() => {}}
      {...over}
    />
  );

describe("two groups, because only one of them is work", () => {
  it("splits unmarked from entered, and counts each", () => {
    const html = render();
    expect(html).toContain("Needs a result · 2");
    expect(html).toContain("Entered · 1");
    // The work is ABOVE the record — a flat list makes the runner scan for it.
    expect(html.indexOf("Needs a result")).toBeLessThan(html.indexOf("Entered ·"));
  });

  it("drops a group entirely rather than showing it empty", () => {
    // An empty "Needs a result · 0" is a heading over nothing, and it is the
    // best news on the screen — it should read as finished, not as a section.
    const allIn = render({ slate: SLATE.map((g) => ({ ...g, result: "home" as const })) });
    expect(allIn).not.toContain("Needs a result");
    expect(allIn).toContain("Entered · 3");

    const noneIn = render({ slate: SLATE.map((g) => ({ ...g, result: null })) });
    expect(noneIn).toContain("Needs a result · 3");
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
    expect(html).not.toContain('data-testid="pickem-run-runner-pill"');
    // ...but the games are still there, so this is not passing by rendering
    // nothing.
    expect(html).toContain("Oklahoma");
    expect(html).toContain("Entered · 1");
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

  it("declines to repeat the header when the count is the same", () => {
    /**
     * Measured on the live slate: nine unmarked games, four live matches, and
     * every game read the same "4" the header had already given. A game drops
     * below `matchesPending` only when some live match has no stake on it —
     * both sides on the same team at the same rank — which is rare with
     * distinct ranks across sixteen games.
     *
     * So the line earns its place when it is SURPRISING, and repeating the
     * header beside every row makes the surprising one harder to find.
     *
     * The pair is the assertion: same inputs but for the header's number.
     */
    const uniform = render({ ridingOn: new Map([["g1", 4]]), matchesPending: 4 });
    expect(uniform).not.toContain("riding on this");
    // ...and it is still saying the number once, up top.
    expect(uniform).toContain("4 matches hang on them");

    const differs = render({ ridingOn: new Map([["g1", 2]]), matchesPending: 4 });
    expect(differs).toContain("2 matches are still riding on this");
  });

  it("summarises the runner's remaining work in the header", () => {
    const html = render();
    expect(html).toContain("2 games still to mark");
    expect(html).toContain("4 matches hang on them");
  });

  it("keeps the header summary away from a member", () => {
    // It is a to-do list, and a member has nothing to do on it.
    expect(render({ canEdit: false })).not.toContain("still to mark");
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
