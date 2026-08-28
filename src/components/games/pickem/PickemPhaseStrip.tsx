"use client";

import { useState } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";
import { toLocalInputValue, fromLocalInputValue, formatDeadline } from "./PickemDeadlineRow";
import type { PickemPhase } from "@/lib/pickemLifecycle";

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

export interface PickemPhaseStripProps {
  phase: PickemPhase;
  slateCount: number;
  /** ISO, or null for "no deadline — I will lock by hand". */
  deadline: string | null;
  busy: boolean;
  onOpenPicks: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onDeadlineChange: (isoOrNull: string | null) => void;
}

export function PickemPhaseStrip({
  phase,
  slateCount,
  deadline,
  busy,
  onOpenPicks,
  onLock,
  onUnlock,
  onDeadlineChange,
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
      label: "Lock picks",
      onClick: onLock,
      testId: "pickem-strip-lock",
      consequence: "Closes every sheet immediately and reveals them to the trip.",
    });
  }
  if (phase === "locked") {
    moves.push({
      label: "Unlock picks",
      onClick: onUnlock,
      testId: "pickem-strip-unlock",
      consequence: "Reopens every sheet for editing and hides them again. Nothing is lost.",
    });
  }

  // A deadline only means something once picks can close against it. Offering
  // it while building would let a runner schedule a close for a game nobody can
  // pick in yet.
  const showDeadline = phase !== "building";

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
            style={{ fontSize: TYPE_SCALE.body, fontWeight: 700 }}
            data-testid="pickem-strip-phase"
          >
            {PHASE_LABEL[phase]}
          </span>
          <span
            className="mt-0.5 block"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}
          >
            {phase === "building" && slateCount === 0
              ? "Add some games to the slate before you can open picks."
              : PHASE_DETAIL[phase]}
          </span>
        </span>
      </div>

      {moves.map((m) => (
        <span key={m.testId} className="flex flex-col gap-1">
          <button
            type="button"
            onClick={m.onClick}
            disabled={busy}
            data-testid={m.testId}
            className="rounded-xl px-4 py-2.5 disabled:opacity-40"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 700,
              minHeight: 44,
            }}
          >
            {busy ? "Working…" : m.label}
          </button>
          {/* Two-word labels are not enough for actions that change what sixteen
              other people can see, so each available move carries its own
              consequence rather than the row carrying one generic caption. */}
          <span
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}
          >
            {m.consequence}
          </span>
        </span>
      ))}

      {showDeadline && (
        <div
          className="flex flex-col gap-1.5 pt-1"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
          data-testid="pickem-strip-deadline"
        >
          {!editingDeadline ? (
            <div className="flex items-center gap-3 pt-1.5">
              <span className="min-w-0 flex-1">
                <span
                  className="block"
                  style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}
                >
                  {deadline ? `Closes ${formatDeadline(deadline)}` : "No deadline set"}
                </span>
                <span
                  className="mt-0.5 block"
                  style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
                >
                  {deadline
                    ? "Picks close on their own then."
                    : "Picks stay open until you lock them."}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setDraft(toLocalInputValue(deadline));
                  setEditingDeadline(true);
                }}
                data-testid="pickem-strip-deadline-edit"
                className="shrink-0 rounded-lg px-3 py-1.5"
                style={{
                  fontSize: TYPE_SCALE.caption,
                  fontWeight: 600,
                  background: "transparent",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                  minHeight: 36,
                }}
              >
                {deadline ? "Change" : "Set"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-1.5">
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
