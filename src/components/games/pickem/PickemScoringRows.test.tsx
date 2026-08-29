import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PickemScoringRows,
  PickemTotalPointsRow,
  type PickemSettingsDraft,
} from "./PickemScoringRows";

/**
 * The two scoring settings, now on the settings page rather than buried in the
 * slate modal.
 *
 * Three of the cases below MOVED here from `PickemSlateModal.test.tsx` when the
 * UI did — they are the same assertions about the same controls, and deleting
 * them because the file they lived in no longer renders those controls would
 * have quietly dropped coverage the move was supposed to preserve.
 */

const ON: PickemSettingsDraft = { rollUp: "team_totals", useConfidence: true };

const render = (over: Partial<Parameters<typeof PickemScoringRows>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemScoringRows
      settings={ON}
      editable
      frozenReason={null}
      showRollUp
      onChange={() => {}}
      {...over}
    />
  );

/**
 * Total Points is its own row now — it belongs to the page's GAME MANAGEMENT
 * zone, which this component does not own, so it is passed through as a slot
 * rather than emitted here.
 */
type PointsProps = Partial<Parameters<typeof PickemTotalPointsRow>[0]>;
const points = (over: PointsProps = {}) =>
  renderToStaticMarkup(
    <PickemTotalPointsRow
      pointsTotal={8}
      canEditPoints
      matches={[]}
      rollUp="team_totals"
      onPointsChange={() => {}}
      {...over}
    />
  );

/** The divisor line only exists under individual matches, so every case about
 *  it must say so — the harness default is team_totals, which correctly hides
 *  it. Five of these failed on that before the default was made explicit, which
 *  is the harness lying rather than the component. */
const indiv = (over: PointsProps = {}) =>
  points({ rollUp: "individual_matches", ...over });

const paired = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ sideAId: `a${i}`, sideBId: `b${i}`, pointValue: null }));

describe("total points — the setting that decides whether any of this matters", () => {
  it("renders under EVERY roll-up, because every roll-up uses a total", () => {
    // Individual matches divide it, team totals award it whole, points mode
    // splits it across places. None of them can work without one.
    for (const rollUp of ["individual_matches", "team_totals"] as const) {
      const html = points({ rollUp, pointsTotal: 8 });
      expect(html, rollUp).toContain('data-testid="row-total-points"');
    }
  });

  it("the EACH-WORTH line renders only under individual matches", () => {
    // Team totals awards the whole total to one side, so a per-match figure
    // would be a number about a mechanic it does not have — spec §5's falsehood
    // rule applied to arithmetic.
    expect(points({ rollUp: "individual_matches", matches: paired(8) }))
      .toContain('data-testid="pickem-per-match"');
    expect(points({ rollUp: "team_totals", matches: paired(8) }))
      .not.toContain('data-testid="pickem-per-match"');
  });

  it("DIVIDES BY VALID MATCHES — 8 over 8 is 1.00, 8 over 7 is 1.14", () => {
    // The §10 test that must fail against a divisor assuming 8. An uneven field
    // is the normal case the moment one person sits out.
    const eight = indiv({ pointsTotal: 8, matches: paired(8) });
    expect(eight).toContain("Points per match:");
    expect(eight).toContain("1.00");
    const seven = indiv({ pointsTotal: 8, matches: paired(7) });
    expect(seven).toContain("1.14");
  });

  it("an UNPAIRED match does not count toward the divisor", () => {
    // Eight rows, one with an empty slot → seven valid. Asserted through a
    // half-filled match rather than a shorter list, because that is the state
    // the pairing grid actually produces.
    const withGap = [...paired(7), { sideAId: "a7", sideBId: null, pointValue: null }];
    expect(indiv({ pointsTotal: 8, matches: withGap })).toContain("1.14");
  });

  it("WARNS when matches are set and the total is 0 — surfaced, never blocking", () => {
    // The silent-wrong this phase exists to end: pairing looked right and
    // awarded nothing, because nothing ever set a total.
    const html = indiv({ pointsTotal: 0, matches: paired(8) });
    expect(html).toContain("0.00");
    expect(html).toContain("the game decides nothing");
    // Still editable — a runner may legitimately set the total later.
    expect(html).toContain('data-testid="row-total-points"');
  });

  it("...and warns on NULL too, which is a different state from 0", () => {
    expect(indiv({ pointsTotal: null, matches: paired(8) })).toContain("the game decides nothing");
  });

  it("does NOT warn before there are matches to be worth anything", () => {
    // Nagging about a total on a game with no field yet is noise at the one
    // moment the runner has not got there.
    const html = indiv({ pointsTotal: 0, matches: [] });
    expect(html).not.toContain("the game decides nothing");
    // Substring chosen to avoid the apostrophe, which renders as &#x27; — the
    // same escaping that bit an earlier assertion on a note containing "Hasn't".
    expect(html).toContain("Set the matches and each one");
  });

  it("points stay editable once picks are OPEN — they are not frozen with the slate", () => {
    /**
     * Migration 152's reason: the total changes what the game is worth, not
     * anything a participant already decided. Freezing it would make a mid-trip
     * 0-point game fixable only by reopen, which clears every ranking.
     *
     * Two components now — the row sits in the page's GAME MANAGEMENT zone and
     * the rest under PICK'EM SETTINGS — so the fact is asserted across both.
     * That is stronger than it was: it checks the stepper is actually enabled
     * rather than merely present.
     */
    const row = indiv({ canEditPoints: true, pointsTotal: 8, matches: paired(8) });
    expect(row).toContain('data-testid="row-total-points"');
    // The ATTRIBUTE, not the word: Tailwind renders `disabled:opacity-40` on
    // every stepper button whether or not anything is disabled, so a bare
    // substring passes against a frozen control. Third time this session that
    // a class or an SVG attribute has answered for the thing being asserted.
    expect(row).not.toContain('disabled=""');

    // ...while the settings beside it ARE frozen.
    const frozen = render({
      editable: false,
      frozenReason: "Picks are open, so scoring is frozen — REASON.",
    });
    expect(frozen).toContain('data-testid="pickem-scoring-frozen"');
    expect(frozen).toContain('disabled=""');
  });
});

describe("the scoring settings", () => {
  it("reads at the settings-row size, not as a footnote", () => {
    // Moved from the slate modal's suite. The look's finding: 12px made a
    // scoring setting read like fine print. It now takes ChecklistRow's own
    // title size, which is the same object the bracket and golf pages use.
    const html = render();
    const title = html.indexOf("Confidence Points");
    expect(title).toBeGreaterThan(-1);
    // 16.5/500 is `ChecklistRow`'s title, which is the point: this row is the
    // same object the bracket and golf pages are built from, not a lookalike.
    expect(html.slice(Math.max(0, title - 200), title)).toContain("font-size:16.5px");
  });

  it("hides the roll-up when the competition makes it unreachable", () => {
    // Absent, not disabled — a standalone game has no sides to total.
    // The heading is gone with the radio list — two FORMATS with a sentence
    // each are not a setting with a value, and the sentence is the choice.
    expect(render({ showRollUp: true })).toContain('data-testid="pickem-format-cards"');
    expect(render({ showRollUp: false })).not.toContain('data-testid="pickem-format-cards"');
  });

  it("says what a pick is worth in plain terms, and changes with the switch", () => {
    expect(render({ settings: { ...ON, useConfidence: true } })).toContain(
      "a correct pick scores its rank"
    );
    expect(render({ settings: { ...ON, useConfidence: false } })).toContain(
      "Every correct pick scores 1"
    );
  });

  it("owns NO Save of its own — the page commits (#18)", () => {
    // This used to read "offers Save only once something actually changed",
    // against a private draft this component kept. Both are gone: it is
    // controlled now, and the only Save on the page is the settings bar.
    //
    // Kept as a REGRESSION guard rather than deleted, and it is worth being
    // honest that it is a weak one — the id it looks for no longer exists
    // anywhere, so it can only fail if someone puts a second Save back. That is
    // exactly the change worth catching, but nothing here would notice the
    // component quietly re-growing state under a different name.
    expect(render()).not.toContain('data-testid="pickem-save-scoring"');
    expect(render({ settings: { rollUp: "team_totals", useConfidence: false } })).not.toContain(
      'data-testid="pickem-save-scoring"'
    );
  });

  it("renders what it is GIVEN — no private state to diverge from the page", () => {
    // The assertion that would fail against the old component: it seeded a
    // `useState` from `settings` on first render, so a later change to the prop
    // did not reach the screen. That is the "staged-state lie" in miniature —
    // the page's draft says one thing and the row shows another.
    const on = render({ settings: { rollUp: "team_totals", useConfidence: true } });
    const off = render({ settings: { rollUp: "team_totals", useConfidence: false } });
    expect(on).toContain("a correct pick scores its rank");
    expect(off).toContain("Every correct pick scores 1");
    // ...and the two really are different renders of the same row, not two
    // different rows: the id is stable across both.
    for (const html of [on, off]) expect(html).toContain('data-testid="row-confidence"');
  });

  it("frozen — controls disabled, and it RENDERS whatever reason it is handed", () => {
    // The sentence itself moved OUT of this component. It was a static string
    // here, and static was the bug: the controls are frozen in two phases and it
    // claimed picks were open in both, which is false on a locked game. The
    // phase-correct wording is `scoringFrozenReason`, tested over every phase in
    // `pickemCountdown.test.ts`. What this file still owns is that the reason
    // reaches the screen — so it asserts the caller's text is rendered verbatim,
    // which a component that dropped the prop or kept its own copy would fail.
    const reason = "Picks are locked, so scoring is frozen — SENTINEL. Reopening the slate below.";
    const html = render({ editable: false, frozenReason: reason });
    const toggle = html.slice(html.indexOf('data-testid="pickem-confidence-toggle"') - 400);
    expect(toggle).toContain("disabled");
    // A disabled control with no reason attached teaches nobody why (finding 3).
    expect(html).toContain(reason);
    expect(html).toContain("Reopening the slate");
  });
});

describe("the per-match line — the helper slot that carried the false sentence", () => {
  /**
   * This is the slot that once read "Picks are open, so scoring is frozen" on a
   * locked game. The empty-state half was already checked; this covers what it
   * says when matches DO exist, which is where the arithmetic can lie.
   */
  const paired = (n: number, pointValue: number | null = null) =>
    Array.from({ length: n }, (_, i) => ({
      sideAId: `a${i}`,
      sideBId: `b${i}`,
      pointValue,
    }));

  it("states the real share, and it agrees with the shared divisor", () => {
    // 8 points over 4 matches. Asserting the VALUE, not merely that a number
    // appears — the divisor is `liveMatchPointsPerMatch`, and a line that
    // computed its own would be a second answer to the same question.
    const html = points({
      rollUp: "individual_matches",
      pointsTotal: 8,
      matches: paired(4),
    });
    expect(html).toContain("Points per match:");
    expect(html).toContain("2.00");
  });

  it("counts only matches with BOTH sides filled — the same rows the divisor uses", () => {
    // A half-filled row is scaffolding, not a match. If this counted rows the
    // sentence would disagree with the grid's own header AND with the points.
    const html = points({
      rollUp: "individual_matches",
      pointsTotal: 6,
      matches: [...paired(3), { sideAId: "x", sideBId: null, pointValue: null }],
    });
    expect(html).toContain("2.00");
  });

  it("divides by one match without inventing a plural", () => {
    // The old copy counted the matches in the sentence and had to agree in
    // number with itself. The subtitle no longer states the count — the
    // Matches row does — so what survives here is the arithmetic.
    const html = points({ rollUp: "individual_matches", pointsTotal: 5, matches: paired(1) });
    expect(html).toContain("5.00");
    expect(html).not.toContain("1 matches");
  });

  it("does NOT claim uniformity when a match carries its own value", () => {
    // `liveMatchPointsPerMatch` shares the remainder AFTER overrides, so "each
    // of the N is worth X" would be false for the overridden ones. Pick'em
    // writes no overrides today, which is exactly why this is worth pinning —
    // the sentence is true by accident otherwise.
    const html = points({
      rollUp: "individual_matches",
      pointsTotal: 10,
      matches: [...paired(2), { sideAId: "z", sideBId: "y", pointValue: 4 }],
    });
    expect(html).toContain("for the ones without their own value");
  });

  it("still warns when the matches are set and the total is not", () => {
    // The surfaced-never-blocking case (spec §2): a runner may set the total
    // later, so this says so rather than refusing.
    const html = points({ rollUp: "individual_matches", pointsTotal: 0, matches: paired(3) });
    expect(html).toContain("the game decides nothing");
  });

  it("the empty state promises something that then happens", () => {
    // "Set the matches and each one's share appears here" — and it does. The
    // pair is the assertion: a promise checked only in its own state is a
    // promise nobody verified.
    const empty = points({ rollUp: "individual_matches", pointsTotal: 8, matches: [] });
    expect(empty).toContain("Set the matches and each one");
    const filled = points({ rollUp: "individual_matches", pointsTotal: 8, matches: paired(2) });
    expect(filled).not.toContain("Set the matches and each one");
    expect(filled).toContain("4.00");
  });
});
