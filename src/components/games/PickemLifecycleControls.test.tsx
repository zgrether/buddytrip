import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("START PICKING becomes CLOSE PICKING when picks open, and back again", () => {
    /**
     * One control in two states — which is why the label is the whole
     * explanation and there is no consequence line under it.
     *
     * The labels were "Start" and "Stop". Too bare: on a screen carrying a
     * slate, a deadline and a settings gear, a button called Stop does not say
     * what it stops. Naming the job removes the only ambiguity two words had
     * left — and "Close" lines the control up with the STATE this feature
     * already says in member copy ("Picks are closed"), where Start/Stop needed
     * a reader to connect two different verbs.
     */
    const building = strip({ phase: "building", slateCount: 2 });
    expect(building).toContain('data-testid="pickem-strip-open"');
    expect(building).toContain(">Start picking<");

    const open = strip({ phase: "picks_open" });
    expect(open).toContain('data-testid="pickem-strip-lock"');
    expect(open).toContain(">Close picking<");

    const locked = strip({ phase: "locked", hasResults: false });
    expect(locked).toContain('data-testid="pickem-strip-unlock"');
    expect(locked).toContain(">Reopen<");
  });

  it("REOPEN is not Start, and does not look like it either", () => {
    /**
     * Once picks have closed — by the runner or by the deadline — the act is
     * not starting. It is resuming something that has already run, and the
     * usual reason to press it is that somebody was missed. That is a
     * correction, not the primary act.
     *
     * So the word changes AND the treatment does. The pair is the assertion,
     * and it has to be a pair: a build that renamed the label and left it
     * accent-filled would pass a word-only check while still being the loudest
     * thing on a panel, which is what the demotion is for.
     */
    const locked = strip({ phase: "locked", hasResults: false });
    const btnOf = (html: string, tid: string) => {
      const at = html.indexOf('data-testid="' + tid + '"');
      return html.slice(html.lastIndexOf("<button", at), at + 400);
    };
    const reopen = btnOf(locked, "pickem-strip-unlock");
    expect(reopen).not.toContain("background:var(--color-bt-accent)");
    expect(reopen).toContain("border:1px solid var(--color-bt-border)");

    // ...while the two PRIMARY acts keep the fill.
    expect(btnOf(strip({ phase: "building", slateCount: 2 }), "pickem-strip-open")).toContain(
      "background:var(--color-bt-accent)"
    );
    expect(btnOf(strip({ phase: "picks_open" }), "pickem-strip-lock")).toContain(
      "background:var(--color-bt-accent)"
    );
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
    expect(html).toContain("Add games to the slate first");
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
    // ...and it appears the moment Start has been — and goes again at Stop,
    // which is the pre-Start state for the NEXT cycle.
    expect(strip({ phase: "picks_open" })).toContain('data-testid="pickem-strip-deadline"');
    expect(strip({ phase: "locked" })).not.toContain('data-testid="pickem-strip-deadline"');
  });

  it("hides the deadline once results exist, where it can change nothing", () => {
    /**
     * A deadline is a scheduled close for picks that can REOPEN. Once anything
     * is scored they cannot — `set_pickem_phase('unlock')` refuses outright
     * (migration 165), which is why no Start is offered either.
     *
     * The block went on rendering through all of that: a Set/Change control,
     * and two sentences about unlocking, one line under a panel explaining that
     * unlocking is unavailable. Third instance in this component of copy
     * written for one state and rendered on a condition covering more, and the
     * widest of the three — it showed on every locked-with-results game.
     *
     * The pair is the assertion: same phase, same everything, results the only
     * difference.
     */
    /**
     * Both locked cases are now hidden, so `hasResults` no longer decides this
     * — the PHASE does, and results are one of the states inside it. Asserted
     * as agreement rather than as two literals: the point is that the block
     * cannot come back for one flavour of locked game, whatever the flag says.
     */
    expect(strip({ phase: "locked", hasResults: false })).not.toContain(
      'data-testid="pickem-strip-deadline"'
    );
    expect(strip({ phase: "locked", hasResults: true })).not.toContain(
      'data-testid="pickem-strip-deadline"'
    );
  });

  it("warns that Start will clear a deadline that has already gone", () => {
    /**
     * `unlock` clears the hand lock and nothing else, so on a past-deadline
     * game it achieves nothing on its own. The view therefore clears the spent
     * deadline in the same press — and a button that silently deletes a setting
     * the runner chose is only acceptable if it says so first.
     *
     * The pair is the assertion: the same locked phase with the deadline still
     * ahead must NOT carry the sentence, because there Start reopens picks and
     * leaves the schedule alone.
     */
    expect(
      strip({ phase: "locked", deadlinePassed: true, deadline: "2026-08-01T12:00:00.000Z" })
    ).toContain("Reopen clears it");
    expect(
      strip({ phase: "locked", deadlinePassed: false, deadline: "2027-08-01T12:00:00.000Z" })
    ).not.toContain("Reopen clears it");
    // ...and never where there is no Start to qualify.
    expect(strip({ phase: "locked", hasResults: true, deadlinePassed: true })).not.toContain(
      "Reopen clears it"
    );
  });

  it("names WHERE to add games, not just that games are missing", () => {
    /**
     * "Add some games to the slate before you can start" is an instruction
     * whose object lives on another screen, with nothing saying which. The gear
     * is in this game's own header, so the sentence can point at something the
     * reader can see from where they are standing.
     */
    const html = strip({ phase: "building", slateCount: 0 });
    expect(html).toContain("gear");
    expect(html).toContain("The Picks");
    // ...and it is absent the moment there is a slate to start.
    expect(strip({ phase: "building", slateCount: 2 })).not.toContain("gear");
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
      deadlinePassed={false}
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
    expect(html).toContain("Add games to the slate first");
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
    /**
     * An absent button with no sentence reads as a bug, so the line stays. It
     * used to go on to name Reset scores as the way to clear the condition,
     * and that half is gone (r7 §6): Reset scores clears every result in the
     * game, which is an enormous move to hand somebody in passing because they
     * wondered why one button was missing. Naming the state answers the
     * question; naming that control answers a different one nobody asked.
     */
    const html = strip({ phase: "locked", hasResults: true });
    expect(html).toContain("Results are in");
    expect(html).not.toContain("Reset scores");
    // ...and with nothing scored the move is simply there, needing no
    // explanation. The phase-detail line that used to be asserted here went
    // with the panel restructure: it restated the phase, which the header no
    // longer does and the button never did.
    expect(strip({ phase: "locked", hasResults: false })).toContain(
      'data-testid="pickem-strip-unlock"'
    );
  });

  it("shows the deadline ONLY while picks are open", () => {
    /**
     * A deadline is a scheduled Stop, so it means something in exactly one
     * state. It used to render in `locked` too — the PRE-START state after a
     * Stop — where it showed a spent deadline from the previous cycle beside a
     * Change button, answering a question nobody had asked. Before that it
     * rendered with results in, where reopening is refused outright.
     *
     * The three cases together are the assertion: hidden either side, present
     * in the middle. Only the pair proves the condition is a WINDOW rather than
     * a flag that happens to be off.
     */
    expect(strip({ phase: "building", slateCount: 2 })).not.toContain(
      'data-testid="pickem-strip-deadline"'
    );
    expect(strip({ phase: "picks_open" })).toContain('data-testid="pickem-strip-deadline"');
    expect(strip({ phase: "locked" })).not.toContain('data-testid="pickem-strip-deadline"');
  });

  it("says whether a deadline exists, and what that means either way", () => {
    const none = strip({ phase: "picks_open", deadline: null });
    expect(none).toContain("No deadline set");
    // START / STOP is the vocabulary. This said "until you lock them", and
    // there is no Lock control anywhere — a second word for one action is how a
    // runner ends up hunting for a button that does not exist.
    expect(none).toContain("Picks stay open until you close them.");
    expect(none).not.toContain("lock them");

    const set = strip({
      phase: "picks_open",
      deadline: "2026-09-05T17:00:00.000Z",
    });
    expect(set).toContain("Closes automatically ");
    expect(set).not.toContain("Auto-locks");
    /**
     * NO helper line under a scheduled close. It read "2d 4h from now. Nobody
     * has to do anything." — the same fact the headline gives, subtracted, plus
     * a reassurance nobody asked for on a panel whose job is saying what needs
     * doing.
     *
     * The UNSET case above keeps its line, and that pair is the point: there
     * the headline is "No deadline set", and what happens instead is genuinely
     * not derivable from it.
     */
    expect(set).not.toContain("from now");
    expect(set).not.toContain("Nobody has to do anything");
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




  /**
   * DELETED: three cases about the deadline block on a LOCKED game.
   *
   *  - "explains why SET is offered on a game that is already closed"
   *  - "stops promising an auto-lock on a game that is already locked"
   *  - "names the UNLOCK TRAP when the deadline has passed"
   *
   * All three were true, and all three were about copy for a state the block no
   * longer renders in. That is the point of the narrowing rather than a cost of
   * it: each case existed because a sentence written for picks-open had been
   * rendered on a wider condition, and the third had to explain a trap the
   * block itself created. Start clears a spent deadline now, so the trap is
   * gone and the block belongs to one phase — which is a smaller thing to keep
   * correct than three sentences and their conditions.
   */
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

describe("one vocabulary for one action", () => {
  /** Visible TEXT only — attributes carry `pickem-strip-unlock`, which is an
   *  id and not a word anybody reads. */
  const words = (html: string) => html.replace(/<[^>]*>/g, " ").toLowerCase();

  it("says LOCK nowhere a runner can read it, in any phase", () => {
    /**
     * The control is Start / Stop. The deadline copy said "Picks stay open
     * until you lock them" beside a button labelled Stop, and the headline said
     * "Auto-locks Fri 11:35 PM" — two words for one action, which is how a
     * runner ends up hunting for a Lock button that does not exist.
     *
     * Swept over every phase and both deadline states rather than fixed at the
     * two known strings: the defect is the vocabulary, so the assertion has to
     * be about the vocabulary. Asserted on stripped text because the testids
     * legitimately contain "lock" — a raw `not.toContain` would fail against a
     * correct render, which is the substring trap this suite has hit twice.
     */
    for (const phase of ["building", "picks_open", "locked"] as const) {
      for (const deadline of [null, "2026-09-05T17:00:00.000Z"]) {
        for (const hasResults of [false, true]) {
          const text = words(strip({ phase, deadline, hasResults, slateCount: 2 }));
          expect(text, `${phase}/${deadline}/${hasResults}`).not.toContain("lock");
        }
      }
    }
  });

  it("still says CLOSED, which is the state and not the control", () => {
    /**
     * The pair, and the reason the sweep above is not simply "delete words".
     * Member-facing copy about picks being closed is correct and stays — what
     * was wrong was naming the CONTROL twice.
     */
    expect(words(strip({ phase: "locked", hasResults: true }))).toContain("picks stay closed");
  });
});

describe("the post-lock list does not come from the write-scoped query", () => {
  it("never hands `proxyTargets` to the read-only list", () => {
    /**
     * A SOURCE guard, in the shape `TripIdProvider.test.ts` established, because
     * the thing being protected is a wiring decision that no rendered output
     * reveals: both lists take an array of people and both render rows.
     *
     * `pickem_sheet_status` answers "whose sheet may I WRITE", which after the
     * lock is nobody — so pointing the read-only list at it would empty the tab
     * for every member on a locked game while looking entirely reasonable in
     * the diff. The two questions coincide before the lock, which is exactly
     * what makes the mistake easy.
     */
    const view = readFileSync(
      join(process.cwd(), "src/components/games/PickemGameView.tsx"),
      "utf8"
    );
    /**
     * Checked at the BUILDERS rather than at the JSX, because there are two
     * call sites now — the same component renders on both sides of the lock —
     * and slicing from the first `<PickemOtherPicks` checks whichever happens
     * to appear first in the file.
     *
     * The invariant is about the SOURCES: the pre-lock columns come from the
     * write-scoped query, and the post-lock ones must not.
     */
    const builder = (name: string) => {
      const at = view.indexOf("const " + name + ": OtherPicksColumn[]");
      expect(at, name).toBeGreaterThan(-1);
      return view.slice(at, at + 1800);
    };
    expect(builder("proxyColumns")).toContain("proxyTargets");
    expect(builder("otherColumns")).not.toContain("proxyTargets");
    expect(builder("otherColumns")).toContain("q.data.sheets");
  });
});

/**
 * ── THE FINALIZE, ON THE PANEL (r7 §10) ───────────────────────────────────
 *
 * It used to sit at the end of the results list, and these cases used to live
 * in `PickemRunView.test.tsx` with it. What moved is the CHROME and the
 * placement; `GameLifecycleActions` still decides which of the three arms
 * shows, and those arms have their own tests.
 *
 * What is asserted here is the wiring pick'em owns and could get wrong on its
 * own: which input carries "may this be finalized", that the unresolved count
 * changes the button's WEIGHT without gating it, and that the confirm is in
 * front of the tap.
 */
describe("the finalize block", () => {
  const lifecycle = (over: Record<string, unknown> = {}) => ({
    canEdit: true,
    status: "active" as string | null,
    correctionsOpen: false,
    allComplete: true,
    finalizePending: false,
    correctPending: false,
    onFinalize: noop,
    onCorrect: noop,
    unresolvedCount: 0,
    ...over,
  });

  /** The finalize button's own opening tag — not the panel around it. */
  const cta = (html: string) => {
    const at = html.indexOf('data-testid="game-finalize"');
    if (at < 0) return "";
    const btn = html.indexOf("<button", at);
    return html.slice(btn, html.indexOf(">", btn));
  };

  const ACCENT = "background:var(--color-bt-accent)";
  const QUIET = "background:transparent";

  it("offers the finalize once picking has CLOSED, and not before", () => {
    /**
     * `allComplete` is pick'em's picking window, not its resolved count — the
     * mapping the view makes, and the one thing about this block that is a
     * pick'em decision rather than a shared one.
     */
    expect(strip({ lifecycle: lifecycle({ allComplete: true }) })).toContain(
      'data-testid="game-finalize"'
    );
    expect(strip({ lifecycle: lifecycle({ allComplete: false }) })).not.toContain(
      'data-testid="game-finalize"'
    );
  });

  it("is QUIET while contests are unmarked and FULL once they are all in", () => {
    /**
     * §10. Golf never meets this state — `canFinalize` requires `allComplete`
     * there, so its button only exists once the work is done — but pick'em's
     * completeness input is the CLOCK, so the CTA is offered mid-way through
     * the list. A full-weight primary in front of somebody with nine games left
     * to mark urges the wrong thing.
     *
     * Read off the BUTTON's own tag. The panel it sits in has a background of
     * its own and a page-wide search for either string finds that instead —
     * which is the assertion-scope mistake this feature has now made several
     * times.
     */
    expect(cta(strip({ lifecycle: lifecycle({ unresolvedCount: 2 }) }))).toContain(QUIET);
    expect(cta(strip({ lifecycle: lifecycle({ unresolvedCount: 2 }) }))).not.toContain(ACCENT);
    expect(cta(strip({ lifecycle: lifecycle({ unresolvedCount: 0 }) }))).toContain(ACCENT);
  });

  it("ties the weight to the QUESTION, not to a second condition", () => {
    /**
     * The button is understated exactly when pressing it raises a question, so
     * its appearance is a promise about what the tap does. Asserted as the
     * PAIR, because two separately-derived conditions pass every case above
     * right up until they disagree.
     *
     * `confirmUnresolvedFinalize` is `unresolved > 0 && canFinalize`, so the
     * state where it cannot ask — nothing finalizable — must not be quiet
     * either. It renders no button at all, which is the same promise kept.
     */
    expect(cta(strip({ lifecycle: lifecycle({ unresolvedCount: 5, allComplete: false }) }))).toBe(
      ""
    );
  });

  it("prints NO standing warning about unresolved contests — it asks at the tap", () => {
    /**
     * The banner this replaced was skippable and, worse, told a runner entering
     * results to keep entering results. The rule lives at the tap now, so the
     * screen must be quiet about it.
     */
    const html = strip({ lifecycle: lifecycle({ unresolvedCount: 2 }) });
    expect(html).not.toContain("pickem-unresolved-warning");
    expect(html).not.toContain("score nothing for everyone");
    expect(html).toContain('data-testid="game-finalize"');
  });

  it("does not render the prompt until the tap", () => {
    // State-driven: a render with unresolved games shows the button and nothing
    // else. The confirm is a response to an action, not to a state.
    expect(strip({ lifecycle: lifecycle({ unresolvedCount: 3 }) })).not.toContain(
      "pickem-finalize-prompt"
    );
  });

  it("calls the correction 'a result', because pick'em has no scores", () => {
    const html = strip({
      phase: "locked",
      hasResults: true,
      lifecycle: lifecycle({ status: "complete", correctionsOpen: false }),
    });
    expect(html).toContain("Correct a result");
    expect(html).not.toContain("Correct a score");
  });

  it("offers the RE-LOCK while corrections are open", () => {
    const html = strip({
      phase: "locked",
      hasResults: true,
      lifecycle: lifecycle({ status: "complete", correctionsOpen: true }),
    });
    expect(html).toContain('data-testid="game-relock"');
  });

  it("renders NO block at all without a lifecycle — absent, never disabled", () => {
    const html = strip();
    expect(html).not.toContain('data-testid="game-finalize"');
    expect(html).not.toContain('data-testid="game-correct"');
    // ...and the panel itself is still there, so this is not an empty render.
    expect(html).toContain('data-testid="pickem-phase-strip"');
  });

  it("does not displace the phase move — they share the slot as siblings", () => {
    /**
     * The two are mutually exclusive in practice, and this asserts the panel
     * does not ENFORCE that from over here: a branch picking one would be a
     * claim about `gameLifecycle` made in the wrong file, and it would hide a
     * real control if the claim ever stopped holding.
     */
    const html = strip({
      phase: "picks_open",
      lifecycle: lifecycle({ status: "complete", correctionsOpen: true }),
    });
    expect(html).toContain('data-testid="pickem-strip-lock"');
    expect(html).toContain('data-testid="game-relock"');
  });
});

/**
 * ── SOURCE GUARD: the confirm is actually IN FRONT of the finalize ─────────
 *
 * Written because a mutation exposed a real hole rather than because the shape
 * felt worth pinning. Deleting the interception entirely — so tapping Save
 * finalizes at once and the prompt never opens — broke NOTHING behaviourally.
 * The rule (`confirmUnresolvedFinalize`) is tested exactly and the dialog's
 * markup is tested by rendering it, but the WIRE between them had no cover.
 *
 * It has none behaviourally here either, and that is a limit rather than a
 * choice: this suite is `environment: "node"` with `renderToStaticMarkup`, so
 * nothing clicks, and the prompt is state-driven and therefore invisible to a
 * static render by construction.
 *
 * What it proves: the CTA's `onFinalize` consults `needsConfirm` rather than
 * going straight through. What it does not prove: that the confirm button then
 * calls the handler. That half is covered by the pure predicate plus the
 * prompt's own render — and if this surface ever gets a Playwright spec, the
 * tap is the thing to put in it.
 */
describe("the confirm sits in front of the finalize (source)", () => {
  const SRC = readFileSync(join(__dirname, "pickem", "PickemPhaseStrip.tsx"), "utf8");

  it("the scan can see the CTA at all — not passing on a renamed file", () => {
    // The vacuity check. A guard reading the wrong file, or one whose contents
    // moved, would otherwise assert happily about nothing. It moved once
    // already, which is exactly the event this catches.
    expect(SRC).toContain("GameLifecycleActions");
    expect(SRC).toContain("confirmUnresolvedFinalize");
  });

  it("onFinalize is routed through needsConfirm", () => {
    /**
     * ── THIS ASSERTION USED TO BE A REGEX, AND THE REGEX WAS BROKEN ────────
     *
     * It read `/onFinalize={s*needsConfirms*?/` — every backslash had been
     * eaten somewhere between being written and being saved. The whitespace
     * classes collapsed to a literal letter s, and the escaped question mark
     * became a lazy quantifier on it. It happened to match the current formatting and would have gone on passing
     * against `onFinalize={needsConfirmAnything`.
     *
     * The exact string is the better assertion anyway: there is one correct
     * line here and it is worth naming in full. Nothing to escape, so nothing
     * to lose in transit.
     */
    expect(
      SRC.includes(
        "onFinalize={needsConfirm ? () => setConfirming(true) : lifecycle.onFinalize}"
      ),
      "GameLifecycleActions' onFinalize no longer consults needsConfirm. Tapping " +
        "Save with unresolved contests would finalize immediately and the prompt " +
        "would never open — which no behavioural test in this suite can see, " +
        "because it runs in node and nothing clicks."
    ).toBe(true);
  });

  it("the quiet flag reads the SAME condition as the confirm", () => {
    // §10's promise: understated exactly when the tap asks. Two expressions of
    // one condition is the shape that drifts, so there is one.
    expect(SRC).toContain("quiet={needsConfirm}");
  });

  it("the prompt calls the SAME handler, not a second finalize path", () => {
    // The confirm is a question about this action. A second call site would be
    // a second aftermath to keep in step.
    expect(SRC).toContain("lifecycle.onFinalize();");
    // Counted by split rather than by a regex, for the reason above.
    expect(SRC.split("lifecycle.onFinalize").length - 1).toBe(2);
  });
});
