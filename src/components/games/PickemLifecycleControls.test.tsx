import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhaseBody, PickemSlateRow } from "./PickemGameView";
import { PickemScoringRows } from "./pickem/PickemScoringRows";
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

/** The settings page's own rows, assembled the way the page assembles them. */
const settingsRows = (over: { slateCount?: number } = {}) =>
  renderToStaticMarkup(
    <PickemScoringRows
      settings={{ rollUp: "team_totals", useConfidence: true }}
      editable
      frozenReason={null}
      showRollUp
      slateCount={16}
      onChange={() => {}}
      slateRow={
        <PickemSlateRow
          slateCount={over.slateCount ?? 2}
          weightedCount={0}
          useConfidence
          onOpenSlate={() => {}}
        />
      }
    />
  );

/** The accent fill is what makes a control read as THE action. */
describe("ONE runner panel, persisting across every phase", () => {
  /**
   * The building screen carried THREE calls to action for one job: this panel
   * titled "Building the slate" with a full-width Open picks, a separate
   * "You're in charge" banner with Configure, and a floating
   * "Open picks · N games" under a paragraph explaining it. Two of the three
   * were the same action.
   */
  it("says the same header and helper in every phase", () => {
    for (const phase of ["building", "picks_open", "locked"] as const) {
      const html = strip({ phase, slateCount: 16 });
      expect(html, phase).toContain("You’re in charge of pick’em");
      expect(html, phase).toContain("Current pick’em slate: 16 games");
    }
  });

  it("counts one game as a game", () => {
    expect(strip({ phase: "building", slateCount: 1 })).toContain("slate: 1 game");
    expect(strip({ phase: "building", slateCount: 1 })).not.toContain("1 games");
  });

  it("START becomes STOP when picks open, and back again", () => {
    // One control in two states — which is why the label is the whole
    // explanation and there is no consequence line under it.
    const building = strip({ phase: "building", slateCount: 2 });
    expect(building).toContain('data-testid="pickem-strip-open"');
    expect(building).toContain(">Start<");

    const open = strip({ phase: "picks_open" });
    expect(open).toContain('data-testid="pickem-strip-lock"');
    expect(open).toContain(">Stop<");

    const locked = strip({ phase: "locked", hasResults: false });
    expect(locked).toContain('data-testid="pickem-strip-unlock"');
    expect(locked).toContain(">Start<");
  });

  it("stops restating the phase, and drops the consequence copy", () => {
    /**
     * "Building the slate" is a status, not a call to act, and
     * "Everyone can start filling in their sheet, and the slate freezes" under
     * a button called Start is the button saying itself twice.
     */
    for (const phase of ["building", "picks_open", "locked"] as const) {
      const html = strip({ phase, slateCount: 2 });
      expect(html, phase).not.toContain("Building the slate");
      expect(html, phase).not.toContain("Everyone can start filling in their sheet");
      expect(html, phase).not.toContain("Nobody can pick yet");
      expect(html, phase).not.toContain("Closes every sheet immediately");
    }
  });

  it("keeps the ONE sentence that is not a phase restatement", () => {
    // Why an action a runner expects to find is missing — which the button
    // cannot say, because the button is not there.
    const html = strip({ phase: "locked", hasResults: true });
    expect(html).toContain("Results are in");
    expect(html).not.toContain('data-testid="pickem-strip-unlock"');
  });

  it("offers no Start with an empty slate, and says why", () => {
    const html = strip({ phase: "building", slateCount: 0 });
    expect(html).not.toContain('data-testid="pickem-strip-open"');
    expect(html).toContain("Add some games to the slate before you can start.");
  });

  it("hides the deadline until Start has been pressed", () => {
    /**
     * A deadline is a close scheduled against picks that are open, so offering
     * one while building would schedule a close for a game nobody can pick in
     * — and it would put a second control on the one screen whose whole job is
     * Start.
     *
     * `building` IS "Start has not been pressed", so the phase is the
     * condition and there is no flag to keep in sync.
     */
    expect(strip({ phase: "building", slateCount: 2 })).not.toContain(
      'data-testid="pickem-strip-deadline"'
    );
    // ...and it appears the moment Start has been.
    expect(strip({ phase: "picks_open" })).toContain('data-testid="pickem-strip-deadline"');
    expect(strip({ phase: "locked" })).toContain('data-testid="pickem-strip-deadline"');
  });

  it("carries the owner-attention marker", () => {
    // The amber treatment the rest of the app uses when something is the
    // owner's to act on.
    expect(strip({ phase: "building", slateCount: 2 })).toContain("--color-bt-owner");
  });
});

describe("the member's words render for everyone, runner included", () => {
  it("says the same thing to a member and to the runner", () => {
    /**
     * Spec §3.1's fairness rule: "nothing added yet" and "a finished slate,
     * unpublished" must be indistinguishable from outside. `PhaseBody` now
     * takes NO props at all, which is the strongest form of that — it has
     * nothing to branch on.
     */
    const html = renderToStaticMarkup(<PhaseBody />);
    expect(html).toContain("Picks open soon");
    expect(html).not.toContain('data-testid="pickem-open-picks"');
    expect(html).not.toContain('data-testid="pickem-configure"');
    // No COUNT leaks — the member copy says "slate of games", so asserting the
    // bare word "games" would have failed against correct output.
    expect(html).not.toMatch(/\d+ games/);
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
      now={Date.parse("2026-09-03T13:00:00.000Z")}
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
    // stronger fact is structural: the settings rows take no `phase` at all.
    // They cannot render a command for a state they cannot be told about — the
    // compiler enforces what this used to check at runtime.
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
    expect(html).toContain('data-testid="row-the-picks"');
    expect(html).toContain('data-testid="row-confidence"');
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
    // ...and with nothing scored the move is simply there, needing no
    // explanation. The phase-detail line that used to be asserted here went
    // with the panel restructure: it restated the phase, which the header no
    // longer does and the button never did.
    expect(strip({ phase: "locked", hasResults: false })).toContain(
      'data-testid="pickem-strip-unlock"'
    );
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

    const set = strip({
      phase: "picks_open",
      deadline: "2026-09-05T17:00:00.000Z",
      now: Date.parse("2026-09-03T13:00:00.000Z"),
    });
    expect(set).toContain("Auto-locks ");
    // The lead time, and the sentence that is the whole point of the redesign:
    // the runner does not have to be holding the phone when this fires.
    expect(set).toContain("2d 4h from now");
    expect(set).toContain("Nobody has to do anything");
  });

  it("never says picks are OPEN on a locked game — every combination", () => {
    /**
     * A RULE over the whole matrix, not another case, and that is the point.
     *
     * The first pass made every branch mentioning a SET deadline phase-aware
     * and left the UNSET one alone, so a hand-locked game with no deadline went
     * on reading "Picks stay open until you lock them" with its picks locked.
     * One screen, two sentences, opposite claims — and a per-case assertion
     * would have passed the fix that caused it.
     *
     * Stated as "no locked render may claim picks are open", it also catches
     * the next phase-blind sentence somebody adds.
     */
    const OPEN_CLAIMS = ["Picks stay open", "stay open until you lock"];
    for (const deadline of [null, "2026-09-05T17:00:00.000Z", "2026-09-01T17:00:00.000Z"]) {
      for (const hasResults of [false, true]) {
        const html = strip({
          phase: "locked",
          deadline,
          hasResults,
          now: Date.parse("2026-09-03T13:00:00.000Z"),
        });
        for (const claim of OPEN_CLAIMS) {
          expect(html, `locked / deadline=${deadline} / results=${hasResults}`).not.toContain(
            claim
          );
        }
      }
    }

    // Non-vacuous: the sentence is real, and it is correct in the phase it
    // belongs to. Without this the loop would pass against a strip that says
    // nothing at all.
    expect(strip({ phase: "picks_open", deadline: null })).toContain("Picks stay open");
  });

  it("explains why SET is offered on a game that is already closed", () => {
    // The block is the runner's only way out of the past-deadline trap, so it
    // stays on a locked game — which leaves the button needing a reason. A
    // deadline there is a setting for after an unlock, not a clock.
    const html = strip({ phase: "locked", deadline: null });
    expect(html).toContain("Picks are already closed");
    expect(html).toContain("would only matter if you unlock them");
    expect(html).toContain('data-testid="pickem-strip-deadline-edit"');
  });

  it("stops promising an auto-lock on a game that is already locked", () => {
    /**
     * Live, a hand-locked game read "Auto-locks Fri, Aug 28, 11:35 PM · 4h 22m
     * from now" with its picks already closed — a future event on a game where
     * there is nothing left to lock.
     *
     * PENDING is not the same as SET, and the strip had them as one condition.
     */
    const html = strip({
      phase: "locked",
      deadline: "2026-09-05T17:00:00.000Z",
      now: Date.parse("2026-09-03T13:00:00.000Z"),
    });
    expect(html).not.toContain("Auto-locks");
    expect(html).not.toContain("from now");
    expect(html).not.toContain("--color-bt-warning-faint");
    expect(html).toContain("Picks are already closed");
  });

  it("names the UNLOCK TRAP when the deadline has passed", () => {
    /**
     * `unlock` clears `picks_locked_at` and nothing else, so a game past its
     * deadline is not reopened by pressing it (migration 151, restated in 156
     * and 159). Editing the deadline is the only way out.
     *
     * Which is why the block cannot be hidden on a locked game — the tempting
     * simplification would leave a runner pressing Unlock and watching nothing
     * happen, with the one control that would help removed from the screen.
     */
    const html = strip({
      phase: "locked",
      deadline: "2026-09-01T17:00:00.000Z",
      now: Date.parse("2026-09-03T13:00:00.000Z"),
    });
    expect(html).toContain("Deadline passed");
    expect(html).toContain("Unlocking won’t reopen picks until this moves.");
    // The way out is still on screen.
    expect(html).toContain('data-testid="pickem-strip-deadline-edit"');
  });

  it("paints the deadline block amber only when something is SCHEDULED", () => {
    /**
     * Amber says "this will happen on its own". On an UNSET deadline it would
     * dress the absence of an event up as an event — empty-versus-unknown, in
     * colour rather than in copy.
     *
     * The pair is the assertion: a strip that never used amber would satisfy
     * the negative half on its own.
     */
    expect(strip({ phase: "picks_open", deadline: "2026-09-05T17:00:00.000Z" })).toContain(
      "--color-bt-warning-faint"
    );
    expect(strip({ phase: "picks_open", deadline: null })).not.toContain(
      "--color-bt-warning-faint"
    );
  });

  it("gives the one action a fixed weight, with nothing to demote it against", () => {
    /**
     * This replaced a case asserting the manual move was DEMOTED to a ghost
     * whenever a deadline existed. That distinction is gone with the second
     * button: there is one action now, right-justified and sized to its label,
     * so there is no pair to rank.
     *
     * What survives is the part that mattered — the control a runner reaches
     * for on the day a kickoff moves must not be small.
     */
    for (const deadline of [null, "2026-09-05T17:00:00.000Z"]) {
      const html = strip({ phase: "picks_open", deadline });
      const at = html.indexOf('data-testid="pickem-strip-lock"');
      expect(at, String(deadline)).toBeGreaterThan(-1);
      const btn = html.slice(html.lastIndexOf("<button", at), at + 400);
      expect(btn, String(deadline)).toContain("min-height:40px");
      expect(btn, String(deadline)).toContain("background:var(--color-bt-accent)");
    }
  });
});
