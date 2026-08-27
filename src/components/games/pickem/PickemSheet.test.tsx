import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSheet, type PickemSheetGame } from "./PickemSheet";
import { defaultSheet, type SheetPick } from "@/lib/pickemSheet";

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
      myPicks={[]}
      editable
      saving={false}
      saveError={null}
      deadlineMs={4 * 3_600_000}
      closure={null}
      onSave={() => {}}
      {...over}
    />
  );

/** The markup of one element's OPENING TAG only.
 *
 *  Written because `toContain("disabled")` matched the Tailwind class
 *  `disabled:opacity-40` during Phase 2 — the assertion passed off a class name
 *  rather than the attribute, on a build where nothing was disabled at all. */
/** Just the "How this works" body — the `<p data-para>` block and nothing else.
 *
 *  Bounded by the paragraph markers rather than by whatever `data-testid`
 *  happens to come next: the first version bounded it on the step nav, which is
 *  ABSENT in the confidence-off case it was written for, so the slice ran to the
 *  end of the document and matched the save bar's "rank them next". A
 *  "must not contain" over an over-wide slice fails loudly; over a slice that
 *  can come back empty it passes silently, which is the worse direction. */
const howBody = (html: string): string => {
  const paras = html.match(/<p data-para="[^"]+">.*?<\/p>/g);
  return (paras ?? []).join(" ");
};

const tagWith = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const open = html.lastIndexOf("<", at);
  return html.slice(open, html.indexOf(">", at) + 1);
};

describe("the sheet, confidence ON", () => {
  it("renders two passes", () => {
    const html = render();
    expect(html).toContain('data-testid="pickem-step-nav"');
    expect(html).toContain("1 · Pick winners");
    expect(html).toContain("2 · Rank them");
  });

  it("starts on pass 1 with a COMPLETE sheet — home team everywhere", () => {
    // Spec §4. Nobody has a partial sheet, ever.
    const html = render();
    const homeTags = html.split('data-testid="pickem-side-home"').length - 1;
    expect(homeTags).toBe(SLATE.length);
    // Every home button selected, every away button not.
    expect(html.split('data-testid="pickem-side-home" data-selected="true"').length - 1).toBe(
      SLATE.length
    );
    expect(html).not.toContain('data-testid="pickem-side-away" data-selected="true"');
  });

  it("every row carries spread, kickoff, note and multiplier when present", () => {
    const html = render();
    expect(html).toContain("-3.5");
    expect(html).toContain("Sat Nov 8, 7:30p");
    expect(html).toContain("Hasn&#x27;t won in Athens since 2015");
    expect(html).toContain("2×");
    expect(html).toContain('data-testid="pickem-multiplier-badge"');
  });

  it("a TBD kickoff renders TBD, not a time", () => {
    // Phase 2b: ESPN's midnight-UTC placeholders are TBD games, and the sheet
    // must not invent 12:00a for them. The sheet renders the stored string
    // verbatim — `formatKickoff` already decided, on ESPN's `timeValid` flag.
    const html = render();
    expect(html).toContain("Sat Nov 8, TBD");
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
    const html = render({ myPicks: defaultSheet(SLATE) });
    expect(html).not.toMatch(/\d+\s*(of|\/)\s*\d+\s*submitted/i);
    expect(html).not.toMatch(/submitted/i);
  });
});

describe("the sheet, confidence OFF", () => {
  const OFF: Props["settings"] = { useConfidence: false, rollUp: "individual_matches" };

  it("RENDERS NO STEP NAVIGATION — absent, not disabled (§11)", () => {
    // ── One of the two §9 tests that must fail against a plausible wrong build.
    // A disabled second tab is the obvious implementation, screenshots fine, and
    // every confidence-ON test passes against it.
    const html = render({ settings: OFF });
    expect(html).not.toContain('data-testid="pickem-step-nav"');
    expect(html).not.toContain("Rank them");
    expect(html).not.toContain("2 ·");
    // ...and the pass that DOES exist is still there, so this is not passing
    // because the component rendered nothing.
    expect(html).toContain('data-testid="pickem-pick-pass"');
    expect(html).toContain('data-testid="pickem-side-home"');
  });

  it("the save bar does not claim the sheet is RANKED", () => {
    // Found at the Cadence look, not here: the bar read "All 16 picked and
    // ranked" on a game with no ranking. Same falsehood rule as the explanation
    // copy, one component further down, and invisible unless you open the off
    // variant — which is why §10 asks for two looks rather than one.
    const html = render({ settings: OFF });
    expect(html).toContain("All 3 picked");
    expect(html).not.toContain("and ranked");
  });

  it("renders no ranking anywhere — no chips, no scale, no order", () => {
    const html = render({ settings: OFF });
    expect(html).not.toContain('data-testid="pickem-rank-chip"');
    expect(html).not.toContain('data-testid="pickem-rank-pass"');
    expect(html).not.toContain("surest");
  });

  it("the explanation drops every ranking sentence", () => {
    // ── The second §9 must-fail test, in its copy half.
    const explanation = howBody(render({ settings: OFF }));
    expect(explanation).not.toMatch(/rank/i);
    expect(explanation).not.toMatch(/coin flip/i);
    expect(explanation).not.toMatch(/surest/i);
    // The premise: the explanation rendered at all. Without it the three
    // assertions above are satisfied by an empty string — which is exactly what
    // the first version of this test sliced out of the markup, and it passed.
    expect(explanation).toContain("Pick a winner in all 3 games");
  });
});

describe("the explanation follows the settings", () => {
  it("head-to-head sentences are absent under team totals", () => {
    const html = render({ settings: { useConfidence: true, rollUp: "team_totals" } });
    const body = howBody(html);
    expect(body).not.toMatch(/head to head/i);
    expect(body).not.toMatch(/one person on the other team/i);
    expect(body).toContain("adds into one team total");
  });

  it("...and present under individual matches, including the load-bearing line", () => {
    // The premise check for the test above.
    const html = render();
    expect(html).toContain("head to head");
    expect(html).toContain("more certain than they are");
  });

  it("is open by default for someone who has never submitted", () => {
    expect(render()).toContain('data-testid="pickem-how-body"');
  });

  it("...and collapsed once a sheet is in", () => {
    const html = render({ myPicks: defaultSheet(SLATE) });
    expect(html).not.toContain('data-testid="pickem-how-body"');
    // The toggle is still there — collapsed, not removed.
    expect(html).toContain('data-testid="pickem-how-toggle"');
  });
});

describe("submitted, reset and locked", () => {
  it("SUBMITTING DOES NOT LOCK — the pick controls stay live", () => {
    const html = render({ myPicks: defaultSheet(SLATE) });
    // The attribute on the button's OWN tag, not the `disabled:` Tailwind class.
    expect(tagWith(html, 'data-testid="pickem-side-away"')).not.toContain("disabled");
    expect(html).toContain("Saved · change it any time");
  });

  it("a reopened slate says so, and asks for the ranking back", () => {
    // Stored picks with no ranks — exactly what migration 150's reopen leaves.
    const cleared: SheetPick[] = SLATE.map((g) => ({
      slateGameId: g.id,
      pick: "away",
      confidence: null,
    }));
    const html = render({ myPicks: cleared });
    expect(html).toContain('data-testid="pickem-ranking-reset"');
    expect(html).toContain("your ranking was cleared");
    // ...and the WINNERS survived, which is the half that must not be lost.
    expect(html.split('data-testid="pickem-side-away" data-selected="true"').length - 1).toBe(
      SLATE.length
    );
  });

  it("a locked sheet is read-only, and says who can change it (nobody)", () => {
    const html = render({ editable: false, myPicks: defaultSheet(SLATE) });
    expect(html).toContain('data-testid="pickem-sheet-locked"');
    // Substring stops before the apostrophe: the copy now reads "whoever's
    // running it" with a curly quote, which renders as an HTML entity.
    // Says it ONCE — the first draft repeated "whoever's running it" across
    // two sentences, which only showed up when rendered.
    expect(html).toContain("not even whoever");
    expect(html.match(/whoever/g) ?? []).toHaveLength(1);
    expect(tagWith(html, 'data-testid="pickem-side-away"')).toContain("disabled");
    // No save bar at all — not a disabled one.
    expect(html).not.toContain('data-testid="pickem-save-bar"');
    expect(html).not.toContain('data-testid="pickem-step-nav"');
    // The ranking is shown inline instead, since there is no second pass to
    // navigate to.
    expect(html).toContain('data-testid="pickem-rank-chip"');
  });

  it("SAYS WHEN PICKS CLOSED after a deadline — §8.4", () => {
    // The case the rule is about: someone opens their sheet after the clock ran
    // out. A silently read-only form reads as a broken app; naming the moment
    // reads as a rule. Nobody is notified — reminders need a scheduler — so
    // this sentence is the only explanation that exists.
    const closedAt = new Date(2026, 10, 8, 11, 0).getTime();
    const html = render({
      editable: false,
      myPicks: defaultSheet(SLATE),
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
      myPicks: defaultSheet(SLATE),
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
    const html = render({ editable: false, myPicks: defaultSheet(SLATE) });
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
    expect(html.split('data-testid="pickem-pick-row"').length - 1).toBe(SLATE.length);
    expect(tagWith(html, 'data-testid="pickem-side-away"')).not.toContain("disabled");
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
