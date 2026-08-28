import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseBody, SlateSettingsRows } from "./PickemGameView";
import { PickemPhaseStrip } from "./pickem/PickemPhaseStrip";

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
      canEdit
      scoringRows={<div data-testid="scoring-rows-slot" />}
      onOpenSlate={noop}
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

const strip = (over: Partial<Parameters<typeof PickemPhaseStrip>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemPhaseStrip
      phase="picks_open"
      slateCount={16}
      deadline={null}
      busy={false}
      hasResults={false}
      onOpenPicks={noop}
      onLock={noop}
      onUnlock={noop}
      onDeadlineChange={noop}
      {...over}
    />
  );

describe("the phase strip carries the lifecycle — settings carries none of it", () => {
  /**
   * ── Why these moved off the settings page ────────────────────────────────
   *
   * Once that page grew a Cancel/Save footer, a command inside its frame made
   * the screen promise two contradictory things: the footer says nothing is
   * committed yet, and the button had already committed. Press "Open picks",
   * then Cancel, and a reasonable person expects the open to be undone.
   *
   * A setting drafts; a command executes. The split is the fix, not a layout
   * preference — which is why the assertions below come in pairs: present on
   * the strip, ABSENT from settings.
   */

  it("SETTINGS renders no phase command and no deadline", () => {
    // Asserted on ONE render rather than a loop over phases, because the
    // stronger fact is structural: `SlateSettingsRows` no longer takes a
    // `phase` at all. It cannot render a command for a state it cannot be told
    // about — the compiler enforces what this used to check at runtime.
    //
    // Kept anyway as the regression guard for someone re-adding a button here,
    // which is the change worth catching.
    const html = settingsRows({ slateCount: 2 });
    expect(html).not.toContain("Open picks");
    expect(html).not.toContain("Lock picks");
    expect(html).not.toContain("Unlock picks");
    expect(html).not.toContain("deadline");
    expect(html).not.toContain("Deadline");
    // ...and it still renders the things that ARE settings, so this is not
    // passing by rendering nothing.
    expect(html).toContain('data-testid="pickem-open-slate"');
    expect(html).toContain('data-testid="scoring-rows-slot"');
  });

  it("building with a slate offers OPEN, and only that", () => {
    const html = strip({ phase: "building", slateCount: 2 });
    expect(html).toContain('data-testid="pickem-strip-open"');
    expect(html).not.toContain('data-testid="pickem-strip-lock"');
    expect(html).not.toContain('data-testid="pickem-strip-unlock"');
  });

  it("building with an EMPTY slate offers no move, and says why", () => {
    // `set_pickem_phase` refuses this with EMPTY_SLATE. A button whose only
    // outcome is that error should not be on screen — and the absence needs a
    // reason, or it reads as a broken page.
    const html = strip({ phase: "building", slateCount: 0 });
    expect(html).not.toContain('data-testid="pickem-strip-open"');
    expect(html).toContain("Add some games to the slate");
  });

  it("picks open offers LOCK; locked offers UNLOCK; never both", () => {
    // They are one toggle presented as whichever half applies. Offering both
    // would ask the runner which state the game is in — which the line above
    // them already states.
    for (const phase of ["building", "picks_open", "locked"] as const) {
      const html = strip({ phase, slateCount: 2 });
      const lock = html.includes('data-testid="pickem-strip-lock"');
      const unlock = html.includes('data-testid="pickem-strip-unlock"');
      expect(lock && unlock, phase).toBe(false);
    }
    expect(strip({ phase: "picks_open" })).toContain('data-testid="pickem-strip-lock"');
    expect(strip({ phase: "locked" })).toContain('data-testid="pickem-strip-unlock"');
  });

  it("stops offering UNLOCK once results are in", () => {
    /**
     * The client half of migration 165. The server refuses the call; this is
     * why the runner is never offered it, because a control that is offered
     * and then refused is the shape this project keeps rejecting.
     *
     * The positive case is the control: without it, a strip that never showed
     * unlock at all would pass the absence assertion.
     */
    const withResults = strip({ phase: "locked", hasResults: true });
    expect(withResults).not.toContain('data-testid="pickem-strip-unlock"');
    expect(strip({ phase: "locked", hasResults: false })).toContain(
      'data-testid="pickem-strip-unlock"'
    );
  });

  it("EXPLAINS the missing move rather than just dropping it", () => {
    // An absent button with no sentence reads as a bug. The line names the
     // condition and the action that would clear it, which is the same thing
     // the server refusal says.
    const html = strip({ phase: "locked", hasResults: true });
    expect(html).toContain("Results are in");
    expect(html).toContain("Reset scores");
    // ...and the ordinary locked line is unchanged when nothing is scored.
    expect(strip({ phase: "locked", hasResults: false })).toContain("revealed to the trip");
  });

  it("says what the game IS, not only what the runner can do", () => {
    expect(strip({ phase: "building", slateCount: 2 })).toContain("Building the slate");
    expect(strip({ phase: "picks_open" })).toContain("Picks are open");
    expect(strip({ phase: "locked" })).toContain("Picks are locked");
  });

  it("every available move states its consequence for everyone else", () => {
    // Two-word labels are not enough for actions that change what sixteen
    // people can see.
    expect(strip({ phase: "building", slateCount: 2 })).toContain(
      "Everyone can start filling in their sheet"
    );
    expect(strip({ phase: "picks_open" })).toContain("Closes every sheet immediately");
    expect(strip({ phase: "locked" })).toContain("Nothing is lost");
  });

  it("the deadline appears once picks can close against it, not while building", () => {
    // Scheduling a close for a game nobody can pick in yet is a state with no
    // meaning.
    expect(strip({ phase: "building", slateCount: 2 })).not.toContain(
      'data-testid="pickem-strip-deadline"'
    );
    expect(strip({ phase: "picks_open" })).toContain('data-testid="pickem-strip-deadline"');
    expect(strip({ phase: "locked" })).toContain('data-testid="pickem-strip-deadline"');
  });

  it("says whether a deadline exists, and what that means either way", () => {
    const none = strip({ phase: "picks_open", deadline: null });
    expect(none).toContain("No deadline set");
    expect(none).toContain("Picks stay open until you lock them");

    const set = strip({ phase: "picks_open", deadline: "2026-09-05T17:00:00.000Z" });
    expect(set).toContain("Closes ");
    expect(set).toContain("Picks close on their own then");
  });
});
