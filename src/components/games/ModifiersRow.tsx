"use client";

import { ChevronRight, Lock } from "lucide-react";

/**
 * Game Modifiers drill-down row for a game's Options section — a labeled button
 * that opens the full-screen ModifierCards editor. Shared by every format that
 * offers modifiers (stroke, rack, …) so the row can't drift per-surface; the
 * caller owns the ModifierCards overlay + the games.modifiers persistence.
 * Shown only when the format has compatible modifiers (an empty set hides it).
 */
export function ModifiersRow({
  count,
  onClick,
  disabled,
  locked,
}: {
  /** Number of enabled modifiers (drives the summary line). */
  count: number;
  onClick: () => void;
  disabled?: boolean;
  /** #512 Option B: live-scoring lock → dim + a lock icon instead of the chevron. */
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", opacity: locked ? 0.55 : undefined }}
    >
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Game Modifiers <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· optional</span>
        </span>
        <span className="truncate text-sm" style={{ color: count > 0 ? "var(--color-bt-text)" : "var(--color-bt-text-dim)", marginTop: 2 }}>
          {count > 0 ? `${count} modifier${count === 1 ? "" : "s"} added` : "Add special rules"}
        </span>
      </div>
      {locked
        ? <Lock size={15} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
        : <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />}
    </button>
  );
}
