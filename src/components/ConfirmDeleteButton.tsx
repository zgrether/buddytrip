"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * Full-width destructive action for modal/drawer footers (canonical
 * "danger-above-footer" pattern). On first click it arms into an inline
 * confirmation — a faint-danger container with a prompt, a ghost "Cancel"
 * that disarms, and a solid-danger "Delete" that fires `onConfirm`. This
 * guards against accidental deletes when the button sits next to Save.
 */
export function ConfirmDeleteButton({
  onConfirm,
  pending = false,
  label = "Delete",
  confirmLabel = "Delete",
  pendingLabel = "Deleting…",
  prompt = "Are you sure?",
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
  testId?: string;
}) {
  const [armed, setArmed] = useState(false);

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
