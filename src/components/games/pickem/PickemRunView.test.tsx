import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
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
     * The void lost its clause for a different reason. It read "Cancelled —
     * never played", which was true while a runner pressing Void was the only
     * way to produce the value. Finalizing now voids whatever is outstanding,
     * and those games were probably played — so the clause became a claim the
     * row cannot support. "Voided" is true of both producers and does not
     * invite the "somebody cancelled the entry" misreading either.
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

/**
 * ── THE FINALIZE, at the end of the runner's job ───────────────────────────
 *
 * `GameLifecycleActions` decides WHICH of the three CTAs shows; those arms have
 * their own tests. What is asserted here is the wiring pick'em owns and could
 * get wrong on its own: which input carries "may this be finalized", that the
 * unresolved count warns without gating, and that a locked game stops offering
 * result entry.
 */
describe("the finalize block", () => {
  const lifecycle = (over: Partial<Parameters<typeof PickemRunView>[0]["lifecycle"] & object> = {}) => ({
    canEdit: true,
    status: "active" as string | null,
    correctionsOpen: false,
    allComplete: true,
    finalizePending: false,
    correctPending: false,
    onFinalize: () => {},
    onCorrect: () => {},
    unresolvedCount: 0,
    ...over,
  });

  it("offers the finalize once picking has CLOSED, and not before", () => {
    /**
     * `allComplete` is pick'em's picking window, not its resolved count — the
     * mapping the view makes and the one thing about this block that is a
     * pick'em decision rather than a shared one.
     */
    expect(render({ lifecycle: lifecycle({ allComplete: true }) })).toContain(
      'data-testid="game-finalize"'
    );
    expect(render({ lifecycle: lifecycle({ allComplete: false }) })).not.toContain(
      'data-testid="game-finalize"'
    );
  });

  it("prints NO standing warning about unresolved contests — it asks at the tap", () => {
    /**
     * The banner this replaces was skippable and, worse, it told a runner
     * entering results to keep entering results. The rule now lives at the tap
     * (`confirmUnresolvedFinalize`), so the screen must be quiet about it.
     *
     * Asserted with unresolved games present, which is the only state the old
     * banner rendered in — a build that kept it fails here and nowhere else.
     */
    const html = render({ lifecycle: lifecycle({ unresolvedCount: 2 }) });
    expect(html).not.toContain("pickem-unresolved-warning");
    expect(html).not.toContain("score nothing for everyone");
    // ...and the CTA is there, unblocked. Outstanding contests never gate.
    expect(html).toContain('data-testid="game-finalize"');
  });

  it("does not render the prompt until the tap", () => {
    // It is state-driven, so a render with unresolved games shows the button
    // and nothing else. The confirm is a response to an action, not a state.
    expect(render({ lifecycle: lifecycle({ unresolvedCount: 3 }) })).not.toContain(
      "pickem-finalize-prompt"
    );
  });

  it("calls the correction 'a result', because pick'em has no scores", () => {
    const html = render({
      lifecycle: lifecycle({ status: "complete", correctionsOpen: false }),
    });
    expect(html).toContain("Correct a result");
    expect(html).not.toContain("Correct a score");
  });

  it("offers the RE-LOCK while corrections are open", () => {
    const html = render({
      lifecycle: lifecycle({ status: "complete", correctionsOpen: true }),
    });
    expect(html).toContain('data-testid="game-relock"');
  });

  it("renders NO block at all for a member — absent, never disabled", () => {
    // The view passes no `lifecycle` at all where there is no finalize to offer.
    const html = render();
    expect(html).not.toContain('data-testid="game-finalize"');
    expect(html).not.toContain('data-testid="game-correct"');
    // ...and the results themselves are still on the screen, so this is not
    // passing on an empty render.
    expect(html).toContain('data-testid="pickem-run"');
  });

  it("a LOCKED game shows no outcome buttons — the CTA is the only way in", () => {
    /**
     * The view ANDs `canEdit` with the lock before this prop, so a locked game
     * arrives here read-only. Asserted at this level because what a person can
     * TAP is the observable half; `set_pickem_result` refusing is the other.
     */
    const locked = render({
      canEdit: false,
      lifecycle: lifecycle({ status: "complete", correctionsOpen: false }),
    });
    expect(locked).not.toContain(String.raw`data-testid="pickem-run-away"`);
    expect(locked).not.toContain(String.raw`data-testid="pickem-run-push"`);
    expect(locked).toContain('data-testid="game-correct"');
  });
});

/**
 * ── SOURCE GUARD: the confirm is actually IN FRONT of the finalize ─────────
 *
 * Written because a mutation exposed a real hole rather than because the shape
 * felt worth pinning. Deleting the interception entirely — so tapping Save
 * finalizes at once and the prompt never opens — broke NOTHING in this file or
 * in the pure suite. The rule (`confirmUnresolvedFinalize`) is tested exactly,
 * and the dialog's markup is tested by rendering it, but the WIRE between them
 * had no cover at all.
 *
 * It has none behaviourally either, and that is a limit rather than a choice:
 * this suite is `environment: "node"` with `renderToStaticMarkup`, so nothing
 * clicks, and the prompt is state-driven and therefore invisible to a static
 * render by construction. A guard over the source is what is available.
 *
 * What it proves: the CTA's `onFinalize` consults `needsConfirm` rather than
 * going straight through. What it does not prove: that the confirm button then
 * calls the handler. That second half is covered by the pure predicate plus the
 * prompt's own render — and if this surface ever gets a Playwright spec, the tap
 * is the thing to put in it.
 */
describe("the confirm sits in front of the finalize (source)", () => {
  const SRC = readFileSync(resolve(__dirname, "PickemRunView.tsx"), "utf8");

  it("the scan can see the CTA at all — not passing on a renamed file", () => {
    // The vacuity check. A guard that reads the wrong file, or a file whose
    // contents moved, would otherwise assert happily about nothing.
    expect(SRC).toContain("GameLifecycleActions");
    expect(SRC).toContain("confirmUnresolvedFinalize");
  });

  it("onFinalize is routed through needsConfirm", () => {
    expect(
      /onFinalize={s*needsConfirms*?/.test(SRC),
      "GameLifecycleActions' onFinalize no longer consults needsConfirm. Tapping " +
        "Save with unresolved contests would finalize immediately and the prompt " +
        "would never open — which no behavioural test in this suite can see, " +
        "because it runs in node and nothing clicks."
    ).toBe(true);
  });

  it("the prompt calls the SAME handler, not a second finalize path", () => {
    // The confirm is a question about this action. A second call site would be
    // a second aftermath to keep in step — the shape `oneFinalizePath` exists
    // to prevent one level up.
    expect(SRC).toContain("lifecycle.onFinalize();");
    expect((SRC.match(/lifecycle.onFinalize/g) ?? []).length).toBe(2);
  });
});

/**
 * ── A VOIDED CONTEST IS AN ENTERED ONE ─────────────────────────────────────
 *
 * Finalizing with contests outstanding writes `cancelled` for each, so they stop
 * being a fourth state — rows above the ENTERED list with no label and no
 * controls — and join the pushes as something that was dealt with.
 *
 * Rendered here rather than assumed: the grouping is `result != null`, so the
 * write is what moves them, and this is the assertion that the move actually
 * lands on the screen the runner is looking at.
 */
describe("a voided contest", () => {
  const voided = (i: number) =>
    SLATE.map((g, n) => ({ ...g, result: n === i ? ("cancelled" as const) : g.result }));

  it("sits in ENTERED and reads Voided", () => {
    const html = render({ slate: voided(0) });
    expect(html).toContain("Entered");
    expect(html).toContain("Voided");
  });

  it("does NOT claim the game was never played", () => {
    /**
     * The copy said "Cancelled — never played", which was true while a runner
     * pressing Void was the only producer of the value. A game voided at
     * finalize was probably played and simply never entered, so the clause
     * became a claim the row cannot support.
     */
    const html = render({ slate: voided(0) });
    expect(html).not.toContain("never played");
    expect(html).not.toContain("Cancelled");
  });

  it("is still distinct from a PUSH — two facts, two labels", () => {
    // Both pay nobody and they are not the same thing: one happened and nobody
    // covered, the other was struck from the scoring.
    const html = render({
      slate: SLATE.map((g, n) =>
        n === 0 ? { ...g, result: "cancelled" as const } : n === 1 ? { ...g, result: "push" as const } : g
      ),
    });
    expect(html).toContain("Voided");
    expect(html).toContain("Pushed");
  });
});
