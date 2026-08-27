import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemScoringRows, type PickemSettingsDraft } from "./PickemScoringRows";

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
      showRollUp
      saving={false}
      pointsTotal={8}
      canEditPoints
      matches={[]}
      onPointsChange={() => {}}
      onSave={() => {}}
      {...over}
    />
  );

/** The divisor line only exists under individual matches, so every case about
 *  it must say so — the harness default is team_totals, which correctly hides
 *  it. Five of these failed on that before the default was made explicit, which
 *  is the harness lying rather than the component. */
const indiv = (over: Partial<Parameters<typeof PickemScoringRows>[0]> = {}) =>
  render({ settings: { ...ON, rollUp: "individual_matches" }, ...over });

const paired = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ sideAId: `a${i}`, sideBId: `b${i}`, pointValue: null }));

describe("total points — the setting that decides whether any of this matters", () => {
  it("renders under EVERY roll-up, because every roll-up uses a total", () => {
    // Individual matches divide it, team totals award it whole, points mode
    // splits it across places. None of them can work without one.
    for (const rollUp of ["individual_matches", "team_totals"] as const) {
      const html = render({ settings: { ...ON, rollUp }, pointsTotal: 8 });
      expect(html, rollUp).toContain('data-testid="row-total-points"');
    }
  });

  it("the EACH-WORTH line renders only under individual matches", () => {
    // Team totals awards the whole total to one side, so a per-match figure
    // would be a number about a mechanic it does not have — spec §5's falsehood
    // rule applied to arithmetic.
    expect(render({ settings: { ...ON, rollUp: "individual_matches" }, matches: paired(8) }))
      .toContain('data-testid="pickem-per-match"');
    expect(render({ settings: { ...ON, rollUp: "team_totals" }, matches: paired(8) }))
      .not.toContain('data-testid="pickem-per-match"');
  });

  it("DIVIDES BY VALID MATCHES — 8 over 8 is 1.00, 8 over 7 is 1.14", () => {
    // The §10 test that must fail against a divisor assuming 8. An uneven field
    // is the normal case the moment one person sits out.
    const eight = indiv({ pointsTotal: 8, matches: paired(8) });
    expect(eight).toContain("1.00 pts");
    const seven = indiv({ pointsTotal: 8, matches: paired(7) });
    expect(seven).toContain("1.14 pts");
    expect(seven).toContain("7 matches");
  });

  it("an UNPAIRED match does not count toward the divisor", () => {
    // Eight rows, one with an empty slot → seven valid. Asserted through a
    // half-filled match rather than a shorter list, because that is the state
    // the pairing grid actually produces.
    const withGap = [...paired(7), { sideAId: "a7", sideBId: null, pointValue: null }];
    expect(indiv({ pointsTotal: 8, matches: withGap })).toContain("1.14 pts");
  });

  it("WARNS when matches are set and the total is 0 — surfaced, never blocking", () => {
    // The silent-wrong this phase exists to end: pairing looked right and
    // awarded nothing, because nothing ever set a total.
    const html = indiv({ pointsTotal: 0, matches: paired(8) });
    expect(html).toContain("0.00 pts");
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
    // Migration 152's reason: the total changes what the game is worth, not
    // anything a participant already decided. Freezing it would make a
    // mid-trip 0-point game fixable only by reopen, which clears every ranking.
    const html = indiv({ editable: false, canEditPoints: true, pointsTotal: 8, matches: paired(8) });
    expect(html).toContain('data-testid="row-total-points"');
    // ...while the confidence toggle beside it IS frozen.
    expect(html).toContain("Picks are open, so scoring is frozen");
  });
});

describe("the scoring settings", () => {
  it("reads at the settings-row size, not as a footnote", () => {
    // Moved from the slate modal's suite. The look's finding: 12px made a
    // scoring setting read like fine print. It matches the rows beside it on
    // the settings page, which are 13.
    const html = render();
    const title = html.indexOf("Use confidence points");
    expect(title).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, title - 120), title)).toContain("font-size:13px");
  });

  it("hides the roll-up when the competition makes it unreachable", () => {
    // Absent, not disabled — a standalone game has no sides to total.
    expect(render({ showRollUp: true })).toContain("How points are awarded");
    expect(render({ showRollUp: false })).not.toContain("How points are awarded");
  });

  it("says what a pick is worth in plain terms, and changes with the switch", () => {
    expect(render({ settings: { ...ON, useConfidence: true } })).toContain(
      "A correct pick scores the rank it was given"
    );
    expect(render({ settings: { ...ON, useConfidence: false } })).toContain(
      "Every correct pick is worth one point"
    );
  });

  it("offers Save only once something actually changed", () => {
    // Compared by VALUE, not a touched flag: toggling a switch and toggling it
    // back is not a change, and offering Save for it invites a write that does
    // nothing.
    expect(render()).not.toContain('data-testid="pickem-save-scoring"');
  });

  it("frozen once picks open — controls disabled, and the reason given", () => {
    const html = render({ editable: false });
    const toggle = html.slice(html.indexOf('data-testid="pickem-confidence-toggle"') - 400);
    expect(toggle).toContain("disabled");
    // A disabled control with no reason attached teaches nobody why.
    expect(html).toContain("Picks are open, so scoring is frozen");
    expect(html).toContain("Reopen the slate");
    // ...and no Save, because nothing here can be changed.
    expect(html).not.toContain('data-testid="pickem-save-scoring"');
  });
});
