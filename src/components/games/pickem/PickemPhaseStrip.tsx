"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
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

const PHASE_LABEL: Record<PickemPhase, string> = {
  building: "Building the slate",
  picks_open: "Picks are open",
  locked: "Picks are locked",
};

/** One line per phase, saying what is true for everyone else right now — not
 *  what the runner can do next, which the buttons already say. */
const PHASE_DETAIL: Record<PickemPhase, string> = {
  building: "Nobody can pick yet. The trip sees “picks open soon”.",
  picks_open: "Everyone is filling in their sheet. Nobody can see anyone else’s.",
  locked: "Every sheet is closed and revealed to the trip.",
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
  const moves: { label: string; onClick: () => void; testId: string; consequence: string }[] = [];
  if (phase === "building" && slateCount > 0) {
    moves.push({
      label: "Open picks",
      onClick: onOpenPicks,
      testId: "pickem-strip-open",
      consequence: "Everyone can start filling in their sheet, and the slate freezes.",
    });
  }
  if (phase === "picks_open") {
    moves.push({
      label: "Lock now",
      onClick: onLock,
      testId: "pickem-strip-lock",
      consequence: "Closes every sheet immediately and reveals them to the trip.",
    });
  }
  // Unlock disappears once anything has been scored. The old consequence text
  // said "Nothing is lost", which was true of the SHEETS and false of the game:
  // reopening after a result lets someone re-pick a contest they have watched.
  if (phase === "locked" && !hasResults) {
    moves.push({
      label: "Unlock",
      onClick: onUnlock,
      testId: "pickem-strip-unlock",
      consequence: "Reopens every sheet for editing and hides them again. Nothing is lost.",
    });
  }

  // A deadline only means something once picks can close against it. Offering
  // it while building would let a runner schedule a close for a game nobody can
  // pick in yet.
  const showDeadline = phase !== "building";

  /**
   * ── Why the deadline outranks the button ──────────────────────────────────
   *
   * Auto-lock is the workflow. A runner sets a time on Wednesday and does
   * nothing on Saturday; locking by hand is the exception, for the day a
   * kickoff moves. The old strip had that backwards — an accent-filled "Lock
   * picks" was the loudest thing on the card and the deadline was small text
   * underneath, which reads as "you are expected to press this".
   *
   * So the deadline block takes the fill and the manual move drops below a
   * divider as a ghost. DEMOTION IS VISUAL WEIGHT ONLY — the tap target stays
   * 44, because a rarely-used control on a phone is precisely the one you
   * cannot afford to make small.
   *
   * ── ...but only while there IS one ────────────────────────────────────────
   *
   * With no deadline set, "Lock now" is the only way this game ever closes, and
   * demoting the sole exit is the same mistake pointed the other way. So the
   * ghost treatment is conditioned on a deadline EXISTING, not on the phase.
   */
  const scheduled = showDeadline && deadline != null;

  return (
    <div
      data-testid="pickem-phase-strip"
      className="mx-1 flex flex-col gap-2.5 rounded-xl px-3 py-3"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        {/* No "You're running this" eyebrow. The strip only renders for people
            who ARE running it (`canEdit`), so it told them something they
            already knew — in the tightest space on the screen. The phase and
            the action are the content. */}
        <span className="min-w-0 flex-1">
          <span
            className="block"
            style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 700 }}
            data-testid="pickem-strip-phase"
          >
            {PHASE_LABEL[phase]}
          </span>
          <span
            className="mt-0.5 block"
            style={{
              fontSize: TYPE_SCALE.caption,
              color: "var(--color-bt-text-dim)",
              lineHeight: 1.45,
            }}
          >
            {phase === "building" && slateCount === 0
              ? "Add some games to the slate before you can open picks."
              : phase === "locked" && hasResults
                ? LOCKED_WITH_RESULTS
                : PHASE_DETAIL[phase]}
          </span>
        </span>
      </div>

      {showDeadline && (
        <div data-testid="pickem-strip-deadline">
          {!editingDeadline ? (
            <DeadlineBlock
              deadline={deadline}
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

      {moves.map((m) => (
        <span
          key={m.testId}
          className={scheduled ? "flex items-center gap-3 pt-2.5" : "flex flex-col gap-1"}
          style={scheduled ? { borderTop: "1px solid var(--color-bt-border)" } : undefined}
        >
          {/* Two-word labels are not enough for actions that change what sixteen
              other people can see, so each available move carries its own
              consequence rather than the row carrying one generic caption.

              Beside the ghost once demoted, under the primary otherwise — the
              consequence is what earns the button its weight, so it travels with
              the button rather than staying in a fixed slot. */}
          {scheduled && (
            <span
              className="min-w-0 flex-1"
              style={{
                fontSize: TYPE_SCALE.caption,
                color: "var(--color-bt-text-dim)",
                lineHeight: 1.45,
              }}
            >
              {m.consequence}
            </span>
          )}
          <button
            type="button"
            onClick={m.onClick}
            disabled={busy}
            data-testid={m.testId}
            className={
              scheduled
                ? "shrink-0 rounded-xl px-4 py-2 disabled:opacity-40"
                : "rounded-xl px-4 py-2.5 disabled:opacity-40"
            }
            style={
              scheduled
                ? {
                    background: "transparent",
                    border: "1px solid var(--color-bt-border)",
                    color: "var(--color-bt-text-dim)",
                    fontSize: TYPE_SCALE.bodyDense,
                    fontWeight: 600,
                    minHeight: 44,
                  }
                : {
                    background: "var(--color-bt-accent)",
                    color: "var(--color-bt-base)",
                    fontSize: TYPE_SCALE.bodyDense,
                    fontWeight: 700,
                    minHeight: 44,
                  }
            }
          >
            {busy ? "Working…" : m.label}
          </button>
          {!scheduled && (
            <span
              style={{
                fontSize: TYPE_SCALE.caption,
                color: "var(--color-bt-text-dim)",
                lineHeight: 1.45,
              }}
            >
              {m.consequence}
            </span>
          )}
        </span>
      ))}
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
  now,
  onEdit,
}: {
  deadline: string | null;
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

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5"
      style={{
        borderRadius: 11,
        background: set ? "var(--color-bt-warning-faint)" : "var(--color-bt-card-raised)",
        border: `1px solid ${set ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
      }}
    >
      <Clock
        size={15}
        style={{
          color: set ? "var(--color-bt-owner)" : "var(--color-bt-text-dim)",
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
            color: set ? "var(--color-bt-owner)" : "var(--color-bt-text)",
          }}
        >
          {set ? `Auto-locks ${formatDeadline(deadline)}` : "No deadline set"}
        </span>
        <span
          className="mt-0.5 block"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {set
            ? lead > 0
              ? `${formatLeadTime(lead)} from now. Nobody has to do anything.`
              : "Any moment now. Nobody has to do anything."
            : "Picks stay open until you lock them."}
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
          border: `1px solid ${set ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
          color: set ? "var(--color-bt-owner)" : "var(--color-bt-text)",
          minHeight: 36,
        }}
      >
        {set ? "Change" : "Set"}
      </button>
    </div>
  );
}
