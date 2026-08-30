import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheet, type PickemSheetGame } from "./PickemSheet";
import { emptySheet, fillAll, type SheetPick } from "@/lib/pickemSheet";

/**
 * The old default sheet — all home, slate order — as a FIXTURE.
 *
 * Several cases below need a COMPLETE sheet to be about anything: submitted
 * state, locked state, whose sheet it is. They used to get one from
 * `defaultSheet`, which is gone because nothing is pre-filled any more.
 * Building it from the two functions that replaced it keeps those cases testing
 * what they were written to test — and it is exactly the sheet a person now
 * gets by pressing All home.
 */
const filledSheet = (): SheetPick[] => fillAll(emptySheet(SLATE), "home");

/**
 * The sheet, rendered in each of the states a participant can actually be in.
 *
 * Environment is `node` — `renderToStaticMarkup`, no jsdom, nothing clicks. That
 * is a real limit and it is stated rather than worked around: what rendering can
 * witness is *what is on the screen in a given state*, which is where every
 * requirement in HANDOFF §9 that can be got wrong silently lives (an absent
 * step nav, a paragraph about a mechanic that is not in play, a multiplier that
 * did not make it onto the row). Interaction is covered by the pure functions in
 * `pickemSheet.test.ts`, which is where the state transitions live.
 *
 * ── Two of these must fail against a plausible wrong build (§9) ────────────
 * They are marked. Both are about a build that is *almost* right:
 *   * "the step nav is ABSENT" fails against a disabled tab, which is the
 *     obvious implementation and looks fine in a screenshot
 *   * the copy assertions fail against a build that renders the full
 *     explanation regardless of settings — also invisible unless you read it
 */

const game = (over: Partial<PickemSheetGame> = {}): PickemSheetGame => ({
  id: `g-${over.awayTeam ?? "x"}`,
  awayTeam: "Alabama",
  homeTeam: "Georgia",
  spread: null,
  kickoff: "Sat Nov 8, 7:30p",
  note: null,
  multiplier: 1,
  ...over,
});

const SLATE: PickemSheetGame[] = [
  game({ awayTeam: "Alabama", homeTeam: "Georgia", spread: "-3.5", note: "Hasn't won in Athens since 2015" }),
  game({ awayTeam: "Ohio St", homeTeam: "Michigan", multiplier: 2 }),
  game({ awayTeam: "Texas", homeTeam: "Oklahoma", kickoff: "Sat Nov 8, TBD" }),
];

type Props = Parameters<typeof PickemSheet>[0];

const render = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(
    <PickemSheet
      gameId="game-1"
      slate={SLATE}
      settings={{ useConfidence: true, rollUp: "individual_matches" }}
      picks={[]}
      subject={{ userId: "me", name: "Me", isSelf: true, isGuest: false }}
      editable
      saving={false}
      saveError={null}
      deadlineMs={4 * 3_600_000}
      closure={null}
      onSave={() => {}}
      {...over}
    />
  );

const tagWith = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const open = html.lastIndexOf("<", at);
  return html.slice(open, html.indexOf(">", at) + 1);
};

describe("the sheet, confidence ON", () => {
  it("renders ONE list — the row IS the control", () => {
    /**
     * The two-pass step nav is gone. It split one sheet into two screens over
     * the same sixteen games — "1 · Pick winners", then "2 · Rank them" — so
     * the order you were building was invisible while you built it.
     *
     * One row per game now, with the rank chip and the tap targets together.
     */
    const html = render();
    expect(html).not.toContain('data-testid="pickem-step-nav"');
    expect(html).not.toContain("1 · Pick winners");
    expect(html.split('data-testid="pickem-sheet-row"').length - 1).toBe(SLATE.length);
  });

  it("opens on an EMPTY sheet — nothing selected on either side", () => {
    /**
     * Nobody has picks until they submit. The sheet used to open on the home
     * team in every game, on a rule the code never implemented: rows are
     * written on Save and nowhere else, so a person who never submitted holds
     * no rows and scores zero. Only the SHEET pretended otherwise.
     *
     * Asserted per SIDE, and both sides, because "nothing picked" is exactly
     * what a build that lost track of which side won would also produce for one
     * of them. The row count is the third leg: this is not passing by rendering
     * an empty list.
     */
    const html = render();
    expect(html.split('data-testid="pickem-sheet-row"').length - 1).toBe(SLATE.length);

    const homePicked = html.split('data-testid="pickem-team-home" data-picked="true"').length - 1;
    const awayPicked = html.split('data-testid="pickem-team-away" data-picked="true"').length - 1;
    expect(homePicked).toBe(0);
    expect(awayPicked).toBe(0);
  });

  it("refuses to save an empty sheet, and says how far off it is", () => {
    /**
     * The pair to the case above. An empty sheet that could be SENT would be
     * the same bug wearing different clothes — a sheet of nothing scored as a
     * sheet.
     *
     * The count is asserted alongside, because a disabled button with no
     * explanation is the silent refusal this feature keeps removing.
     */
    const html = render();
    expect(tagWith(html, 'data-testid="pickem-submit"')).toContain("disabled");
    expect(html).toContain(`0 of ${SLATE.length} picked`);
  });

  it("never says SAVED over a sheet that holds nothing", () => {
    /**
     * Caught in the look, not here. `needsSave` is false for two OPPOSITE
     * reasons — nothing to save, and something to save that cannot be sent yet
     * — so a label keyed on it alone read "Saved" over an empty sheet. The one
     * word a person would take as confirmation, on a sheet with nothing in it.
     *
     * The pair is the assertion: the same disabled button says the two
     * different things it means.
     */
    expect(render()).toContain(">Save picks<");
    expect(render()).not.toContain(">Saved<");
    expect(render({ picks: filledSheet() })).toContain(">Saved<");
  });

  it("ALL HOME fills the sheet and enables Save", () => {
    // The shortcut is what makes removing the pre-fill affordable: the old
    // default position is one tap away, and now somebody chose it.
    const html = render({ picks: filledSheet() });
    const homePicked = html.split('data-testid="pickem-team-home" data-picked="true"').length - 1;
    expect(homePicked).toBe(SLATE.length);
    expect(html).toContain(`${SLATE.length} of ${SLATE.length} picked`);
    expect(html).toContain('data-testid="pickem-sheet-all-home"');
    expect(html).toContain('data-testid="pickem-sheet-all-away"');
  });

  it("every row carries spread, kickoff, note and multiplier when present", () => {
    const html = render();
    expect(html).toContain("-3.5");
    // The kickoff is a two-line stack now — day over the rest — so it fills the
    // right side the select buttons used to waste. Both halves are asserted
    // because a split that dropped one would still contain the other.
    expect(html).toContain('data-testid="pickem-row-kickoff"');
    expect(html).toContain("Sat");
    expect(html).toContain("Nov 8, 7:30p");
    expect(html).toContain("Hasn&#x27;t won in Athens since 2015");
    expect(html).toContain("2×");
    expect(html).toContain('data-testid="pickem-multiplier-badge"');
  });

  it("a TBD kickoff renders TBD, not a time", () => {
    // Phase 2b: ESPN's midnight-UTC placeholders are TBD games, and the sheet
    // must not invent 12:00a for them. The sheet renders the stored string
    // verbatim — `formatKickoff` already decided, on ESPN's `timeValid` flag.
    const html = render();
    expect(html).toContain("Nov 8, TBD");
    expect(html).not.toContain("12:00a");
  });

  it("weights the row with a 3px left stripe, matching the slate", () => {
    // The stripe comes from `pickemRowSurface`, shared with the slate modal.
    // Asserted on the SERIALISED value, which SSR writes as `border-left-width:3px`
    // — a browser would re-serialise it with a space, which is how a Phase 2
    // probe read "0 stripes" against a page that had them.
    const html = render();
    expect(html).toContain("border-left-width:3px");
    // The premise: unweighted rows are 1px, so "contains 3px" is not being
    // satisfied by every row having it.
    expect(html).toContain("border-left-width:1px");
  });

  it("shows no submission count anywhere — that is the runner's number (§7.3)", () => {
    const html = render({ picks: filledSheet() });
    expect(html).not.toMatch(/\d+\s*(of|\/)\s*\d+\s*submitted/i);
    expect(html).not.toMatch(/submitted/i);
  });
});

describe("the sheet, confidence OFF", () => {
  const OFF: Props["settings"] = { useConfidence: false, rollUp: "individual_matches" };

  it("renders NO RANK CHIP and no reordering — absent, not disabled (§11)", () => {
    // ── One of the two §9 tests that must fail against a plausible wrong build.
    // A disabled second tab is the obvious implementation, screenshots fine, and
    // every confidence-ON test passes against it.
    const html = render({ settings: OFF });
    expect(html).not.toContain('data-testid="pickem-step-nav"');
    expect(html).not.toContain("Rank them");
    expect(html).not.toContain("2 ·");
    // ...and the pass that DOES exist is still there, so this is not passing
    // because the component rendered nothing.
    expect(html).toContain('data-testid="pickem-sheet-row"');
    expect(html).toContain('data-testid="pickem-team-home"');
  });

  it("the progress count does not claim the sheet is RANKED", () => {
    // Found at the Cadence look, not here: the bar read "All 16 picked and
    // ranked" on a game with no ranking. Same falsehood rule as the explanation
    // copy, one component further down, and invisible unless you open the off
    // variant — which is why §10 asks for two looks rather than one.
    //
    // The line it lived on is gone with the save bar; the count that replaced
    // it inherits the rule, and has no room to break it.
    const html = render({ settings: OFF, picks: filledSheet() });
    expect(html).toContain("3 of 3 picked");
    expect(html).not.toContain("and ranked");
  });

  it("renders no ranking anywhere — no chips, no scale, no order", () => {
    const html = render({ settings: OFF });
    expect(html).not.toContain('data-testid="pickem-row-rank"');
    expect(html).not.toContain('data-testid="pickem-step-nav"');
    expect(html).not.toContain("surest");
  });

});

describe("the sheet carries NO explanation of its own", () => {
  const VARIANTS: Props["settings"][] = [
    { useConfidence: true, rollUp: "individual_matches" },
    { useConfidence: false, rollUp: "individual_matches" },
    { useConfidence: true, rollUp: "team_totals" },
  ];

  it("renders neither the explainer body nor its toggle", () => {
    /**
     * The sheet used to own a "How this works" collapsible, built because
     * pick'em never published `rules` through `GameChrome` the way the other
     * four formats do. That left TWO explanations of one game — a hardcoded
     * panel nobody could correct, and an editable `rules_for_today` in settings
     * nobody could see — free to disagree the moment a runner wrote their own.
     *
     * There is one now, on the shared rules surface, seeded with the same
     * derivation. This is the guard that the second one does not come back.
     *
     * Asserted on BOTH testids, and on the prose as well: a panel rebuilt under
     * different testids would pass an id-only check while putting the same
     * sentence back on the screen.
     */
    for (const settings of VARIANTS) {
      const html = render({ settings });
      expect(html).not.toContain('data-testid="pickem-how-body"');
      expect(html).not.toContain('data-testid="pickem-how-toggle"');
      expect(html).not.toContain("How this works");
      expect(html).not.toMatch(/head to head/i);
    }
  });

  it("still renders the PICKING surface — not passing because it rendered nothing", () => {
    // Absence assertions are satisfied by an empty component. This is the
    // premise the four above rest on.
    const html = render();
    expect(html).toContain('data-testid="pickem-sheet-row"');
  });
});

describe("submitted, reset and locked", () => {
  it("SUBMITTING DOES NOT LOCK — the pick controls stay live", () => {
    const html = render({ picks: filledSheet() });
    // The attribute on the button's OWN tag, not the `disabled:` Tailwind class.
    expect(tagWith(html, 'data-testid="pickem-team-away"')).not.toContain("disabled");
    // Submitted and unchanged: the button says so and stays refused, while the
    // rows above it stay live. "Saved · all chalk…" went with the save bar —
    // that phrasing existed to measure DEPARTURE from a pre-fill that no longer
    // happens.
    expect(tagWith(html, 'data-testid="pickem-submit"')).toContain("disabled");
    expect(html).toContain(">Saved<");
  });

  it("a reopened slate says so, and asks for the ranking back", () => {
    // Stored picks with no ranks — exactly what migration 150's reopen leaves.
    const cleared: SheetPick[] = SLATE.map((g) => ({
      slateGameId: g.id,
      pick: "away",
      confidence: null,
    }));
    const html = render({ picks: cleared });
    expect(html).toContain('data-testid="pickem-ranking-reset"');
    expect(html).toContain("your ranking was cleared");
    // ...and the WINNERS survived, which is the half that must not be lost.
    expect(html.split('data-testid="pickem-team-away" data-picked="true"').length - 1).toBe(
      SLATE.length
    );
  });

  it("a locked sheet is read-only, and says who can change it (nobody)", () => {
    const html = render({ editable: false, picks: filledSheet() });
    expect(html).toContain('data-testid="pickem-sheet-locked"');
    // Substring stops before the apostrophe: the copy now reads "whoever's
    // running it" with a curly quote, which renders as an HTML entity.
    // Says it ONCE — the first draft repeated "whoever's running it" across
    // two sentences, which only showed up when rendered.
    expect(html).toContain("not even whoever");
    expect(html.match(/whoever/g) ?? []).toHaveLength(1);
    expect(tagWith(html, 'data-testid="pickem-team-away"')).toContain("disabled");
    // No save bar at all — not a disabled one.
    expect(html).not.toContain('data-testid="pickem-save-bar"');
    expect(html).not.toContain('data-testid="pickem-step-nav"');
    // The ranking is shown inline instead, since there is no second pass to
    // navigate to.
    expect(html).toContain('data-testid="pickem-row-rank"');
  });

  it("SAYS WHEN PICKS CLOSED after a deadline — §8.4", () => {
    // The case the rule is about: someone opens their sheet after the clock ran
    // out. A silently read-only form reads as a broken app; naming the moment
    // reads as a rule. Nobody is notified — reminders need a scheduler — so
    // this sentence is the only explanation that exists.
    const closedAt = new Date(2026, 10, 8, 11, 0).getTime();
    const html = render({
      editable: false,
      picks: filledSheet(),
      closure: { at: closedAt, reason: "deadline" as const },
    });
    expect(html).toContain("Picks closed at");
    expect(html).toContain("11:00");
    // ...and it does not claim the runner did it.
    expect(html).not.toContain("ended early");
  });

  it("distinguishes a HAND LOCK from the deadline", () => {
    // Different causes, different sentences. Telling someone the clock ran out
    // when the runner ended it early is a small lie about why they lost the
    // chance to change something.
    const html = render({
      editable: false,
      picks: filledSheet(),
      closure: { at: Date.now(), reason: "locked" as const },
    });
    expect(html).toContain("ended early");
    expect(html).not.toContain("Picks closed at");
  });

  it("never renders a closed-at time while picks are OPEN", () => {
    // A closure announced on an editable sheet would be the inverse falsehood.
    expect(render({ closure: null })).not.toContain("Picks closed at");
  });

  it("a locked sheet shows no countdown", () => {
    const html = render({ editable: false, picks: filledSheet() });
    expect(html).not.toContain('data-testid="pickem-countdown"');
  });
});

describe("a failed save", () => {
  it("KEEPS THE SHEET and says so", () => {
    // CLAUDE.md #15 / §7.4. The sheet below the error is intact and still
    // editable — the failure mode this guards is a screen that clears back to
    // defaults and looks like nothing happened.
    const html = render({ saveError: "Picks are closed — the deadline passed." });
    expect(html).toContain('data-testid="pickem-save-error"');
    expect(html).toContain("Your sheet is still here");
    expect(html.split('data-testid="pickem-sheet-row"').length - 1).toBe(SLATE.length);
    expect(tagWith(html, 'data-testid="pickem-team-away"')).not.toContain("disabled");
  });
});

describe("the countdown", () => {
  it("appears while picks are open and reads in hours and minutes", () => {
    expect(render()).toContain('data-testid="pickem-countdown"');
    expect(render({ deadlineMs: 4 * 3_600_000 + 12 * 60_000 })).toContain("4h 12m");
  });

  it("is absent when the runner set no deadline", () => {
    // A supported choice, not a missing value — he locks by hand. A countdown to
    // nothing would be the falsehood rule again.
    expect(render({ deadlineMs: null })).not.toContain('data-testid="pickem-countdown"');
  });
});

describe("whose sheet this is, once the footer is gone", () => {
  /**
   * The only way proxy entry goes badly is somebody editing what they think is
   * their own sheet, so the screen has to say whose it is.
   *
   * It used to be the save bar’s status line, and that line is gone with the
   * bar — the two rows that absorbed the bar carry a hint and a count, both of
   * which are about the SHEET rather than about its owner.
   *
   * Nothing was lost, and the replacement is louder: proxy mode renders
   * `PickemProxyBanner` ABOVE the sheet, a band rather than a caption, in a
   * treatment a 11px status line could not compete with. This component does
   * not render it — the view does, above this — which is why the assertion
   * here is that the sheet does not CONTRADICT it.
   */
  it("says nothing about ownership either way, leaving it to the banner", () => {
    const theirs = render({
      subject: { userId: "ty", name: "Ty", isSelf: false, isGuest: false },
    });
    const mine = render();
    for (const html of [theirs, mine]) {
      expect(html).not.toContain("Entering for");
      expect(html).not.toContain("not your sheet");
    }
    // ...and the row that replaced that line is present on both, so this is not
    // passing because the header vanished.
    expect(theirs).toContain("picked");
    expect(mine).toContain("picked");
  });

  it("still refuses to send somebody else an unfinished sheet", () => {
    // The gate is about the SHEET, not the subject — asserted on a proxy
    // subject because that is the path where a hole is least likely to be
    // noticed by the person it belongs to.
    const html = render({
      subject: { userId: "ty", name: "Ty", isSelf: false, isGuest: false },
    });
    expect(tagWith(html, 'data-testid="pickem-submit"')).toContain("disabled");
  });
});
