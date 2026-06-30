"use client";

import { ChevronRight } from "lucide-react";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * The shared danger-zone primitives — the one in-app confirm vocabulary for every
 * destructive action (NO window.confirm anywhere, #433). Extracted from
 * CompetitionSettings so the competition-level ladder (reset scoring → reset
 * skeleton → delete) and the per-game ladder (reset scores → reset settings →
 * delete) render the SAME escalating shape, one level apart.
 *
 *  - SectionLabel        — the uppercase danger-zone heading.
 *  - DangerRow           — one action, in the TRIP danger-zone pattern (#512): an
 *                          icon-square + label + one-line description + chevron that
 *                          opens a focused confirm. The row→confirm friction IS the
 *                          point (destructive = deliberate).
 *  - DangerConfirmModal  — the cost-naming confirm (warning = reversible-but-heavy;
 *                          danger = gone).
 *
 * Purely presentational (no tRPC) — the caller owns the mutations.
 */

export function SectionLabel({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <p
      className="px-1 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: danger ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)" }}
    >
      {children}
    </p>
  );
}

/** One danger-zone action in the TRIP danger-zone pattern (#512): a row of
 *  [icon-square · label + one-line description · chevron] that opens a focused
 *  confirm. `tone` colors the icon-square + label (warning = reversible-but-heavy;
 *  danger = gone). The chevron signals "leads to a confirm", matching trip settings. */
export function DangerRow({
  icon, tone, label, blurb, onClick, testId, disabled,
}: {
  icon: React.ReactNode;
  tone: "warning" | "danger";
  label: string;
  blurb: string;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
}) {
  const color = tone === "danger" ? "var(--color-bt-danger)" : "var(--color-bt-warning)";
  const faint = tone === "danger" ? "var(--color-bt-danger-faint)" : "var(--color-bt-warning-faint)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-[11px] px-3 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-50 disabled:hover:bg-transparent"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid={testId}
    >
      <span
        className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px]"
        style={{ background: faint, color }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color }}>
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          {blurb}
        </span>
      </span>
      <ChevronRight size={17} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
    </button>
  );
}

// ── DangerConfirmModal — the one in-app confirm for every danger-zone action ──
// (No window.confirm anywhere — #433.) Cost-naming body, tone-colored icon/CTA.
export function DangerConfirmModal({
  tone,
  icon,
  title,
  body,
  confirmLabel,
  pendingLabel,
  isPending,
  testId,
  onCancel,
  onConfirm,
}: {
  tone: "warning" | "danger";
  icon: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  testId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const accent = tone === "danger" ? "var(--color-bt-danger)" : "var(--color-bt-warning)";
  const accentFaint = tone === "danger" ? "var(--color-bt-danger-faint)" : "var(--color-bt-warning-faint)";

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onCancel}
      >
        <div
          className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-5 pb-3 text-center sm:text-left">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
              style={{ background: accentFaint, color: accent }}
            >
              {icon}
            </div>
            <h3 className="mt-3 text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
              {title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              {body}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: accent }}
              data-testid={testId}
            >
              {isPending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}
