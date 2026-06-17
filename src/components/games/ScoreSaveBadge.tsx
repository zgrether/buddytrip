"use client";

import { Check, RefreshCw } from "lucide-react";
import type { CellSaveState } from "./types";

/**
 * ScoreSaveBadge — the per-cell save indicator (Connectivity Layer 1).
 *
 * Renders next to a score cell to show whether the write behind the optimistic
 * value landed: a quiet pending dot while saving, a brief check once saved, and
 * — the one that matters on the course — a clear, tappable "Retry" when it
 * couldn't save. `error` cells keep their number; this badge is how the user
 * knows it needs attention instead of trusting a silent (possibly lost) save.
 *
 * Presentational only — `onRetry` is wired by the parent's score saver.
 */
export function ScoreSaveBadge({
  state,
  onRetry,
}: {
  state?: CellSaveState;
  onRetry?: () => void;
}) {
  if (!state) return null;

  if (state === "saving") {
    return (
      <span
        role="status"
        aria-label="Saving"
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: 16, height: 16 }}
      >
        <span
          className="animate-spin rounded-full"
          style={{
            width: 12,
            height: 12,
            border: "2px solid var(--color-bt-text-dim)",
            borderTopColor: "transparent",
            opacity: 0.7,
          }}
        />
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span
        role="status"
        aria-label="Saved"
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: 16, height: 16, color: "var(--color-bt-accent)", opacity: 0.8 }}
      >
        <Check size={14} strokeWidth={3} />
      </span>
    );
  }

  // error — clear and actionable. Stops propagation so it doesn't also trigger
  // the row's player-select tap.
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRetry?.();
      }}
      aria-label="Couldn't save — tap to retry"
      className="inline-flex shrink-0 items-center gap-1"
      style={{
        padding: "2px 7px",
        borderRadius: 9999,
        background: "var(--color-bt-danger-faint)",
        border: "1px solid var(--color-bt-danger-border)",
        color: "var(--color-bt-danger)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <RefreshCw size={11} strokeWidth={2.5} />
      Retry
    </button>
  );
}
