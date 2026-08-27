import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseBody, SlateSettingsRows } from "./PickemGameView";

/**
 * The runner's route from a built slate to open picks, and out again.
 *
 * ── The bug this is written against ────────────────────────────────────────
 *
 * "Open picks" existed from Phase 2 and was reported as missing. It was styled
 * as bare accent text at 12px — no background, no border, no padding — sitting
 * UNDER a filled primary button for "Edit the slate · N games". The state
 * transition sixteen people are waiting on read as a caption for the lesser
 * action beside it.
 *
 * Nothing failed. Every existing test passed. It was found by a person trying
 * to run a game and concluding the app had no switch.
 *
 * So the assertions below are about HIERARCHY, not presence. `getByTestId`
 * would have passed against the broken build — the button was always in the
 * DOM. What was wrong is which control looked like the answer.
 */

const noop = () => {};

const phaseBody = (over: Partial<Parameters<typeof PhaseBody>[0]> = {}) =>
  renderToStaticMarkup(
    <PhaseBody
      slateCount={2}
      canEdit
      onOpenSlate={noop}
      onOpenPicks={noop}
      opening={false}
      {...over}
    />
  );

const settingsRows = (over: Partial<Parameters<typeof SlateSettingsRows>[0]> = {}) =>
  renderToStaticMarkup(
    <SlateSettingsRows
      slateCount={2}
      useConfidence
      phase="building"
      canEdit
      scoringRows={<div data-testid="scoring-rows-slot" />}
      onOpenSlate={noop}
      onOpenPicks={noop}
      onLock={noop}
      onReopen={noop}
      busy={false}
      {...over}
    />
  );

/** The opening tag of the element carrying a testid — so a style assertion is
 *  about THAT control and not about anything nested inside it. */
const tagOf = (html: string, testId: string): string => {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at < 0) return "";
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

/** The accent fill is what makes a control read as THE action. */
const isFilledPrimary = (html: string, testId: string) =>
  tagOf(html, testId).includes("background:var(--color-bt-accent)");

describe("the game page's primary action follows the state", () => {
  it("WITH A SLATE, the filled button is OPEN PICKS — not Edit the slate", () => {
    // The regression. Both controls render in both builds; only the emphasis
    // differs, so presence assertions cannot tell them apart.
    const html = phaseBody({ slateCount: 2 });
    expect(isFilledPrimary(html, "pickem-open-picks")).toBe(true);
    expect(isFilledPrimary(html, "pickem-edit-slate")).toBe(false);
  });

  it("...and Edit the slate is still a real, bordered control", () => {
    // Demoting it must not turn it into the bare text link the other one was.
    const tag = tagOf(phaseBody({ slateCount: 2 }), "pickem-edit-slate");
    expect(tag).toContain("border:1px solid");
  });

  it("names the count, so the button says what it will open", () => {
    expect(phaseBody({ slateCount: 16 })).toContain("Open picks · 16 games");
  });

  it("explains what pressing it does BEFORE it is pressed", () => {
    const html = phaseBody({ slateCount: 2 });
    expect(html).toContain("Everyone can start filling in their sheet");
    expect(html).toContain("reopen it from settings");
  });

  it("WITH NO SLATE, the one job is building it — and Open picks is absent", () => {
    const html = phaseBody({ slateCount: 0 });
    expect(isFilledPrimary(html, "pickem-build-slate")).toBe(true);
    // Absent, not disabled: there is nothing to open.
    expect(html).not.toContain('data-testid="pickem-open-picks"');
    expect(html).not.toContain('data-testid="pickem-edit-slate"');
  });

  it("a plain member sees the words and none of the controls", () => {
    // Spec §3.1: a member cannot tell an empty slate from a finished one, so
    // what leaks must be nothing — including the shape of the runner's buttons.
    const html = phaseBody({ canEdit: false, slateCount: 2 });
    expect(html).toContain("Picks open soon");
    expect(html).not.toContain("data-testid=\"pickem-open-picks\"");
    expect(html).not.toContain("data-testid=\"pickem-edit-slate\"");
    expect(html).not.toContain("2 games");
  });
});

describe("settings carries the whole lifecycle, not just the way back", () => {
  // Reopen used to live here alone, which meant settings held the exit from
  // every state and none of the entrances.
  it("building with a slate offers OPEN, and neither of the others", () => {
    const html = settingsRows({ phase: "building", slateCount: 2 });
    expect(html).toContain('data-testid="pickem-open-picks-settings"');
    expect(html).not.toContain('data-testid="pickem-lock-picks"');
    expect(html).not.toContain('data-testid="pickem-reopen-slate"');
  });

  it("building with an EMPTY slate offers no transition at all", () => {
    // `set_pickem_phase` refuses this with EMPTY_SLATE; the screen should not
    // offer a button whose only outcome is that error.
    const html = settingsRows({ phase: "building", slateCount: 0 });
    expect(html).not.toContain('data-testid="pickem-open-picks-settings"');
  });

  it("picks open offers LOCK and REOPEN, and not a second Open", () => {
    const html = settingsRows({ phase: "picks_open" });
    expect(html).toContain('data-testid="pickem-lock-picks"');
    expect(html).toContain('data-testid="pickem-reopen-slate"');
    expect(html).not.toContain('data-testid="pickem-open-picks-settings"');
  });

  it("locked offers only REOPEN — there is nothing left to lock", () => {
    const html = settingsRows({ phase: "locked" });
    expect(html).not.toContain('data-testid="pickem-lock-picks"');
    expect(html).toContain('data-testid="pickem-reopen-slate"');
  });

  it("every transition says what it does to everyone else", () => {
    // Two-word labels are not enough for actions that change what sixteen
    // people can see, so each available transition carries its consequence.
    expect(settingsRows({ phase: "picks_open" })).toContain("closes every sheet immediately");
    expect(settingsRows({ phase: "building", slateCount: 2 })).toContain(
      "everyone can start filling in their sheet"
    );
  });

  it("names the state above the buttons that change it", () => {
    expect(settingsRows({ phase: "building", slateCount: 2 })).toContain("Picks are not open yet");
    expect(settingsRows({ phase: "picks_open" })).toContain("Picks are open");
    expect(settingsRows({ phase: "locked" })).toContain("Picks are locked");
  });

  it("REOPEN's copy drops the ranking sentence when confidence is off", () => {
    // The falsehood rule again, on the settings side: a confidence-off game has
    // no ranking to redo, and "confidence 1–N" is not what its slate is.
    const on = settingsRows({ phase: "picks_open", useConfidence: true });
    const off = settingsRows({ phase: "picks_open", useConfidence: false });
    expect(on).toContain("re-ranks them");
    expect(off).not.toContain("re-ranks");
    expect(on).toContain("confidence 1–2");
    expect(off).not.toContain("confidence");
  });

  it("puts the scoring settings on this page, not behind the slate", () => {
    // The slot is filled by `PickemScoringRows`; what matters here is that the
    // settings page is where it renders.
    const html = settingsRows();
    expect(html).toContain("How scoring works");
    expect(html).toContain('data-testid="scoring-rows-slot"');
  });

  it("a plain member gets no settings rows at all", () => {
    expect(settingsRows({ canEdit: false })).toBe("");
  });
});
