"use client";

import { useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { TYPE_SCALE } from "@/lib/typeScale";
import { toLocalInputValue, fromLocalInputValue, formatDeadline } from "./PickemDeadlineRow";
import { formatLeadTime, type PickemPhase } from "@/lib/pickemLifecycle";

/**
 * The runner's control: where this game IS, and the moves available from here.
 *
 * ── Why it left the settings panel ─────────────────────────────────────────
 *
 * Not polish — it resolves a contradiction the draft model created. The panel
 * grew a Cancel/Save footer, which promises that nothing on the screen is
 * committed yet. The phase buttons sat INSIDE that frame and had already
 * committed. Same screen, opposite contracts: press "Open picks", then press
 * Cancel, and a reasonable person expects the open to be undone.
 *
 * A settings page drafts. A command executes. Once the panel became a draft the
 * commands could not stay in it, and the distinction is the whole reason this
 * component exists.
 *
 * It also puts the runner's most frequent job where they do it. Open, lock and
 * unlock are things you do repeatedly while the game is live — often standing
 * up, on a phone — and they were two taps deep behind a settings modal.
 *
 * ── The deadline is here, not in settings ──────────────────────────────────
 *
 * "Lock picks now" and "Lock picks at 11:00" are the same intent, unscheduled
 * and scheduled. Putting them on different screens is exactly the split that
 * makes a runner hunt for a control they used yesterday.
 *
 * It self-commits, and that is CONSISTENT here rather than an exception:
 * everything on this strip executes. `set_pickem_deadline` writes one column
 * (migration 153) and is reversible by setting a different one, so there is
 * nothing for a Cancel to undo. That leaves the settings panel with zero
 * non-drafting controls, which is the clean end state.
 *
 * ── Runner-only ────────────────────────────────────────────────────────────
 *
 * Gated on `canEdit` — Owner, Organizer, or this game's delegate, the predicate
 * `useGameEditAccess` already computes and the settings gear already uses. A
 * member's game page shows the phase's CONSEQUENCES (the countdown, the closed
 * banner, their sheet); the runner's adds the control.
 *
 * It sits ABOVE the countdown rather than replacing it. The runner is also a
 * participant — there is no separate runner's sheet — so "Picks close in 4h
 * 59m / change anything until then" is their picker copy and still has to be
 * there.
 */

/**
 * ── ONE panel, and it does not restate the phase ──────────────────────────
 *
 * The building screen used to carry THREE calls to action for one job: this
 * strip titled "Building the slate" with a full-width Open picks, a separate
 * "You're in charge" banner with its own Configure, and a floating
 * "Open picks · N games" under a paragraph explaining what pressing it would
 * do. Three buttons, two of them the same button.
 *
 * What replaced them is one panel that persists across every phase, with a
 * header that never changes and a single right-justified action whose LABEL is
 * the whole explanation. "Building the slate" was a status, not a call to act,
 * and a subtitle restating the phase is a sentence the button already said.
 *
 * The helper is a FACT the runner can use — how many games are on the slate —
 * rather than a description of the state they can already see.
 */
const ACTION_LABEL: Record<PickemPhase, string> = {
  building: "Start",
  picks_open: "Stop",
  // Reopening after a lock. Absent once anything is scored — see `hasResults`.
  locked: "Start",
};

/** Said once results exist, in place of the unlock move — so the absence of the
 *  button is explained rather than merely noticed. */
const LOCKED_WITH_RESULTS =
  "Results are in, so picks stay closed. Clearing the results with Reset scores would reopen them.";

export interface PickemPhaseStripProps {
  phase: PickemPhase;
  slateCount: number;
  /** ISO, or null for "no deadline — I will lock by hand". */
  deadline: string | null;
  busy: boolean;
  /**
   * Has the game produced any outcome yet.
   *
   * Gates UNLOCK, and only unlock. Reopening picks on a game whose results are
   * partly known is not picking — the person already knows how those games
   * went. Migration 165 refuses it server-side; this is why they are not
   * offered it in the first place, because a control that is offered and then
   * refused is the shape this project keeps rejecting.
   */
  hasResults: boolean;
  /**
   * Would Start alone leave picks closed — i.e. has the deadline already gone?
   *
   * Passed in from `deadlineBlocksReopen` rather than derived from the
   * `deadline` prop here, because the VIEW has to act on the same answer: its
   * Start handler clears the spent deadline before unlocking. Two derivations
   * of one comparison is how the button and the thing the button does drift.
   */
  deadlinePassed: boolean;
  onOpenPicks: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onDeadlineChange: (isoOrNull: string | null) => void;
  /**
   * The page's ticking clock, passed in rather than read here.
   *
   * REQUIRED, and not because of the tests. `Date.now()` in a render body is
   * impure — the same props would paint two different lead times — and the game
   * page already owns a `useNow` that every other derivation on the screen
   * reads. Sharing it means the strip's "4h 33m from now" and the countdown
   * below it cannot disagree, which two independent clocks eventually would.
   */
  now: number;
}

export function PickemPhaseStrip({
  phase,
  slateCount,
  deadline,
  busy,
  hasResults,
  deadlinePassed,
  onOpenPicks,
  onLock,
  onUnlock,
  onDeadlineChange,
  now,
}: PickemPhaseStripProps) {
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [draft, setDraft] = useState("");

  /**
   * The moves legal from HERE, and only those.
   *
   * A disabled button for a move that is not available would advertise a
   * mechanic the game does not have at this moment — the same defect as the
   * "Not live — scoring disabled" line Phase 2's look removed. Absent, not
   * disabled.
   */
  /**
   * The ONE move available from here, or none.
   *
   * The consequence sentences that used to sit under each button are gone: the
   * label is the explanation, and "Everyone can start filling in their sheet,
   * and the slate freezes" under a button called Start is the button saying
   * itself twice.
   *
   * Start in the LOCKED phase is the slate-editing path, and it is the whole
   * of it — `slateEditable` is `!picksOpen`, so Stop already makes the slate
   * editable and Start puts it back. No separate edit control is needed, which
   * is why none was added.
   */
  const move: { label: string; onClick: () => void; testId: string } | null =
    phase === "building" && slateCount > 0
      ? { label: ACTION_LABEL.building, onClick: onOpenPicks, testId: "pickem-strip-open" }
      : phase === "picks_open"
        ? { label: ACTION_LABEL.picks_open, onClick: onLock, testId: "pickem-strip-lock" }
        : // Absent once anything is scored: reopening after a result lets
          // somebody re-pick a contest they have already watched, and migration
          // 165 refuses it server-side.
          phase === "locked" && !hasResults
          ? { label: ACTION_LABEL.locked, onClick: onUnlock, testId: "pickem-strip-unlock" }
          : null;

  /**
   * HIDDEN UNTIL START IS PRESSED.
   *
   * A deadline only means something once picks can close against it: offering
   * it while building would let a runner schedule a close for a game nobody
   * can pick in yet, and puts a second control on the one screen whose whole
   * job is Start.
   *
 * `building` is exactly "Start has not been pressed", so the phase IS the
   * condition — no separate flag, and nothing to keep in sync.
   *
   * ── ...and HIDDEN AGAIN once results exist ───────────────────────────────
   *
   * A deadline is a scheduled close for picks that can reopen. Once anything is
   * scored they cannot: `set_pickem_phase('unlock')` refuses outright
   * (migration 165), which is why no Start button is offered either. The block
   * went on rendering through all of that, with a Set/Change control and two
   * sentences about unlocking — offering a setting whose only effect is on a
   * transition the server has closed, one line under a panel saying so.
   *
   * Same shape as the two bugs already recorded in `DeadlineBlock` below: a
   * sentence written for the state its author had in mind, rendered on a
   * condition covering more states than that one. This is the third, and it is
   * the widest — every locked-with-results game showed it.
   */
  const showDeadline = phase !== "building" && !hasResults;

  /**
   * ── The deadline stays IN this panel ─────────────────────────────────────
   *
   * It is not a second call to action — it is the runner's other control, and
   * the only escape from the past-deadline trap its own copy describes.
   * Keeping it here is what makes this ONE panel rather than two.
   *
   * The button-demotion logic that used to live here went with the buttons:
   * there is one action now, right-justified and sized to its label, so there
   * is nothing left to demote it against.
   */

  return (
    <div
      data-testid="pickem-phase-strip"
      className="flex flex-col gap-2.5 rounded-xl px-3 py-3"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex items-center gap-3">
        {/* The owner-attention marker the rest of the app uses — amber, and on
            the panel rather than on the button, because what needs attention is
            that this game has a runner and the runner is you. */}
        <AlertTriangle
          size={16}
          style={{ color: "var(--color-bt-owner)", flexShrink: 0 }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className="block"
            style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 700 }}
            data-testid="pickem-strip-phase"
          >
            You&rsquo;re in charge of pick&rsquo;em
          </span>
          <span
            className="mt-0.5 block"
            style={{
              fontSize: TYPE_SCALE.caption,
              color: "var(--color-bt-text-dim)",
              lineHeight: 1.45,
            }}
          >
            Current pick&rsquo;em slate: {slateCount} game{slateCount === 1 ? "" : "s"}
          </span>
        </span>

        {/* RIGHT-JUSTIFIED and sized to its label, not full width. A full-width
            primary is what made this panel read as a call to action rather than
            as the runner's standing controls. */}
        {move && (
          <button
            type="button"
            onClick={move.onClick}
            disabled={busy}
            data-testid={move.testId}
            className="shrink-0 rounded-lg px-4 disabled:opacity-40"
            style={{
              minHeight: 40,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 700,
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {busy ? "…" : move.label}
          </button>
        )}
      </div>

      {/* The one sentence that is NOT a phase restatement: it says why an
          action a runner expects to find is missing, which the button cannot. */}
      {phase === "locked" && hasResults && (
        <span
          style={{
            fontSize: TYPE_SCALE.caption,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.45,
          }}
        >
          {LOCKED_WITH_RESULTS}
        </span>
      )}
      {/* NAMES WHERE, because "add some games" without it is an instruction
          whose object is on another screen. The settings gear is the route on
          all five formats and it is in this game's own header — so the sentence
          points at something the reader can see from where they are standing,
          which is the whole of the refusal rule. */}
      {phase === "building" && slateCount === 0 && (
        <span
          data-testid="pickem-strip-empty-slate"
          style={{
            fontSize: TYPE_SCALE.caption,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.45,
          }}
        >
          Add games to the slate first — the gear at the top of this page, then
          The Picks.
        </span>
      )}

      {/* Says what Start is about to do that its label cannot.
          Unlocking clears the hand lock and nothing else, so on a game whose
          deadline has gone it would achieve nothing on its own — the button
          therefore clears the spent deadline as part of the same press, and
          this is the one sentence saying so. Without it a runner presses Start,
          watches a deadline they set disappear, and has no idea why. */}
      {phase === "locked" && !hasResults && deadlinePassed && (
        <span
          data-testid="pickem-strip-clears-deadline"
          style={{
            fontSize: TYPE_SCALE.caption,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.45,
          }}
        >
          The deadline has passed, so Start clears it — picks stay open until you
          press Stop.
        </span>
      )}

      {showDeadline && (
        <div data-testid="pickem-strip-deadline">
          {!editingDeadline ? (
            <DeadlineBlock
              deadline={deadline}
              phase={phase}
              now={now}
              onEdit={() => {
                setDraft(toLocalInputValue(deadline));
                setEditingDeadline(true);
              }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <input
                type="datetime-local"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                data-testid="pickem-strip-deadline-input"
                className="rounded-lg px-3 py-2"
                style={{
                  // 16px or iOS zooms the page on focus.
                  fontSize: 16,
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                  minHeight: 44,
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDeadlineChange(fromLocalInputValue(draft));
                    setEditingDeadline(false);
                  }}
                  disabled={busy}
                  data-testid="pickem-strip-deadline-save"
                  className="rounded-lg px-3 py-2 disabled:opacity-40"
                  style={{
                    fontSize: TYPE_SCALE.caption,
                    fontWeight: 700,
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                    minHeight: 40,
                  }}
                >
                  Set deadline
                </button>
                {deadline && (
                  <button
                    type="button"
                    onClick={() => {
                      onDeadlineChange(null);
                      setEditingDeadline(false);
                    }}
                    disabled={busy}
                    data-testid="pickem-strip-deadline-clear"
                    className="rounded-lg px-3 py-2 disabled:opacity-40"
                    style={{
                      fontSize: TYPE_SCALE.caption,
                      fontWeight: 600,
                      background: "transparent",
                      border: "1px solid var(--color-bt-border)",
                      color: "var(--color-bt-text-dim)",
                      minHeight: 40,
                    }}
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingDeadline(false)}
                  className="rounded-lg px-3 py-2"
                  style={{
                    fontSize: TYPE_SCALE.caption,
                    fontWeight: 600,
                    background: "transparent",
                    color: "var(--color-bt-text-dim)",
                    minHeight: 40,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/**
 * The deadline, as the strip's primary element.
 *
 * Amber when something is SCHEDULED and neutral when nothing is — the fill says
 * "this will happen on its own", which is the fact a runner is checking. An
 * unset deadline in amber would dress the absence of an event up as an event,
 * and the empty-versus-unknown rule cuts the same way in colour as in copy.
 */
function DeadlineBlock({
  deadline,
  phase,
  now,
  onEdit,
}: {
  deadline: string | null;
  phase: PickemPhase;
  now: number;
  onEdit: () => void;
}) {
  const set = deadline != null;
  /**
   * `formatDeadline` is `toLocaleString` — the VIEWER's own timezone, which is
   * the only correct rendering when the schema stores no timezone anywhere.
   * Never format this server-side: the server's zone is not the reader's, and a
   * lock time an hour out is worse than no lock time.
   */
  const lead = set ? new Date(deadline).getTime() - now : 0;

  /**
   * PENDING is not the same as SET, and the strip said it was.
   *
   * On a locked game the block read "Auto-locks Fri 11:35 PM · 4h 22m from now"
   * — a future event on a game whose picks had already closed by hand. Nothing
   * will auto-lock; there is nothing left to lock.
   *
   * ── ...and the control still has to be here ────────────────────────────────
   *
   * The tempting fix is to hide the block once locked. It would strand the
   * runner: `unlock` clears `picks_locked_at` and nothing else, so a game past its
   * deadline is NOT reopened by unlocking (migration 151, restated in 156 and
   * 159). The deadline is the thing keeping picks closed, editing it is the
   * only way out, and hiding it would leave a runner pressing Unlock and
   * watching nothing happen.
   *
   * So the block stays and the COPY changes, which is also where the amber
   * goes: amber means "this will happen on its own", and on a locked game it
   * will not.
   *
   * ── The same mistake had a second home, and the first fix missed it ───────
   *
   * Every branch here that mentions a SET deadline was made phase-aware, and
   * the UNSET one was left alone — so a hand-locked game with no deadline went
   * on saying "Picks stay open until you lock them" with its picks locked. One
   * screen, two sentences, opposite claims.
   *
   * That is why the guard below it is a RULE rather than three more cases: no
   * render in the locked phase may contain a sentence that says picks are open.
   * A per-case assertion would have passed the first fix and missed this.
   */
  const pending = set && phase === "picks_open";
  const passed = set && lead <= 0;

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5"
      style={{
        borderRadius: 11,
        background: pending ? "var(--color-bt-warning-faint)" : "var(--color-bt-card-raised)",
        border: `1px solid ${pending ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
      }}
    >
      <Clock
        size={15}
        style={{
          color: pending ? "var(--color-bt-owner)" : "var(--color-bt-text-dim)",
          flexShrink: 0,
        }}
      />
      <span className="min-w-0 flex-1">
        <span
          className="block"
          data-testid="pickem-strip-deadline-when"
          style={{
            fontSize: TYPE_SCALE.body,
            fontWeight: 700,
            color: pending ? "var(--color-bt-owner)" : "var(--color-bt-text)",
          }}
        >
          {!set
            ? "No deadline set"
            : pending
              ? `Auto-locks ${formatDeadline(deadline)}`
              : passed
                ? `Deadline passed ${formatDeadline(deadline)}`
                : `Deadline ${formatDeadline(deadline)}`}
        </span>
        <span
          className="mt-0.5 block"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {!set
            ? phase === "locked"
              ? /* Says why the SET button is here at all on a closed game: a
                   deadline is what would hold picks shut after an unlock, so on
                   this screen it is a setting for later rather than a clock. */
                "Picks are already closed. A deadline would only matter if you unlock them."
              : "Picks stay open until you lock them."
            : pending
              ? lead > 0
                ? `${formatLeadTime(lead)} from now. Nobody has to do anything.`
                : "Any moment now. Nobody has to do anything."
              : passed
                ? /* The trap, named. Unlocking a game past its deadline does
                     nothing at all, and the runner has no other way to tell. */
                  "Unlocking won’t reopen picks until this moves."
                : "Picks are already closed. Unlocking reopens them until then."}
        </span>
      </span>
      <button
        type="button"
        onClick={onEdit}
        data-testid="pickem-strip-deadline-edit"
        className="shrink-0 rounded-lg px-3"
        style={{
          fontSize: TYPE_SCALE.caption,
          fontWeight: 600,
          background: "transparent",
          border: `1px solid ${pending ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
          color: pending ? "var(--color-bt-owner)" : "var(--color-bt-text)",
          minHeight: 36,
        }}
      >
        {set ? "Change" : "Set"}
      </button>
    </div>
  );
}
