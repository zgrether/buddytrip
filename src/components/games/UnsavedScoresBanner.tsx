"use client";

import { CloudOff, RefreshCw } from "lucide-react";

/**
 * UnsavedScoresBanner — the always-visible safety net (Connectivity Layer 1).
 *
 * Per-cell badges flag failures, but the entry view shows one hole at a time —
 * a save that failed on a hole you've since navigated away from would be out of
 * sight. This banner sits at the top of the entry surface whenever ANY cell is
 * unsaved, so the user can never lose track that something didn't save, and can
 * retry every flagged cell at once. Hidden when nothing is pending.
 */
export function UnsavedScoresBanner({
  count,
  onRetry,
}: {
  count: number;
  onRetry: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-between gap-3"
      style={{
        padding: "8px 14px",
        background: "var(--color-bt-danger-faint)",
        borderBottom: "1px solid var(--color-bt-danger-border)",
      }}
    >
      <span
        className="flex items-center gap-2"
        style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-danger)" }}
      >
        <CloudOff size={15} />
        {count} {count === 1 ? "score" : "scores"} didn&apos;t save
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5"
        style={{
          padding: "4px 12px",
          borderRadius: 9999,
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-danger-border)",
          color: "var(--color-bt-danger)",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <RefreshCw size={12} strokeWidth={2.5} />
        Retry{count > 1 ? " all" : ""}
      </button>
    </div>
  );
}
