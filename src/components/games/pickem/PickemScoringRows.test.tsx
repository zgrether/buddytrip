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
      onSave={() => {}}
      {...over}
    />
  );

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
