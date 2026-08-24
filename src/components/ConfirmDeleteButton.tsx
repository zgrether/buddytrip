"use client";

import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

/**
 * Full-width destructive action for modal/drawer footers (canonical
 * "danger-above-footer" pattern). On first click it arms into an inline
 * confirmation — a faint-danger container with a prompt, a ghost "Cancel"
 * that disarms, and a solid-danger "Delete" that fires `onConfirm`. This
 * guards against accidental deletes when the button sits next to Save.
 *
 * ── `blocked` — a refusal that arrives when it is relevant ─────────────────
 * When the action is currently refused, pass the explanation as `blocked`. The
 * idle button STILL renders — the action exists and stays discoverable — and
 * arming shows the explanation in place of the confirm row, so `onConfirm` is
 * unreachable while it is set.
 *
 * This exists because the alternative was tried and read badly: the crew-member
 * modal REPLACED its Delete button with an always-visible blocker panel, so
 * every reader paid for a wall of games and expenses whether or not they were
 * removing anyone — and the majority case (nothing blocking) is the one that
 * should be frictionless. Placement, not content (#1034).
 *
 * Keeping it in THIS component rather than hand-rolling a look-alike button at
 * the call site is CLAUDE.md #24: an inline copy of a shared control agrees
 * with the original only until somebody changes one of them.
 */
export function ConfirmDeleteButton({
  onConfirm,
  pending = false,
  label = "Delete",
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  prompt = "Are you sure?",
  blocked,
  testId,
}: {
  onConfirm: () => void;
  pending?: boolean;
  /** Idle button text, e.g. "Delete receipt", "Remove property". */
  label?: string;
  /** Confirm button text once armed. */
  confirmLabel?: string;
  pendingLabel?: string;
  /** Prompt shown in the armed state. */
  prompt?: string;
  /** Why the action is refused right now. Set → arming explains instead of
   *  confirming, and `onConfirm` can never fire. */
  blocked?: ReactNode;
  testId?: string;
}) {
  const [armed, setArmed] = useState(false);

  // Checked BEFORE the confirm arm, so a blocker appearing while armed (the
  // panel is live — see the invalidation this ships with) converts the open
  // confirm row into the explanation rather than leaving a live Delete button
  // over state that now refuses it.
  if (armed && blocked) {
    return (
      <div
        data-testid="removal-blocked"
        className="rounded-lg p-3"
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {blocked}
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="mt-2.5 w-full rounded-md py-1.5 text-sm font-medium"
          style={{
            background: "transparent",
            color: "var(--color-bt-text-dim)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          Close
        </button>
      </div>
    );
  }

  if (armed) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2"
        style={{
          background: "var(--color-bt-danger-faint)",
          border: "1px solid var(--color-bt-danger-border)",
        }}
      >
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          style={{ color: "var(--color-bt-danger)" }}
        >
          {prompt}
        </span>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          style={{
            background: "transparent",
            color: "var(--color-bt-text-dim)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          data-testid={testId}
          className="rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: "var(--color-bt-danger)", color: "white" }}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      disabled={pending}
      data-testid={testId ? `${testId}-arm` : undefined}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
      style={{
        background: "transparent",
        color: "var(--color-bt-danger)",
        border: "1px solid var(--color-bt-danger-border)",
      }}
    >
      <Trash2 size={14} />
      {label}
    </button>
  );
}
