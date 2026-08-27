"use client";

import { X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * AddEditSheet — the canonical add/edit surface: a bottom sheet on mobile, a
 * right-anchored 440px drawer from `sm` up, on the lighter `card-float` tint.
 * Sticky header, scrolling body, sticky footer.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * It already did, ten times, as copied markup. `AddScheduleItemSheet`,
 * `AddPropertySheet`, `MemberEditor`, `AddExpenseModal`, `EditExpenseModal`,
 * `CreateTripModal`, `IdeaZonePanel` and others each re-declare the same
 * scrim/panel/geometry by hand; the only thing they share today is
 * `useModalBackButton`. One of them calls the arrangement "the canonical
 * edit-drawer spec" — so the spec is written down and simply has nothing
 * enforcing it, which is the state where copies drift.
 *
 * Quick Games needed this same surface (device pass §3), and the choice was
 * to write an eleventh copy or to give the spec a home. This is the home.
 *
 * ── What it deliberately does NOT do yet ───────────────────────────────────
 * It does not migrate those ten. Each is a live trip surface with its own
 * dirty-state, validation and footer wiring, and folding a five-surface
 * refactor into a Quick Games change would put unrelated regressions behind
 * one review. They move separately, and the follow-up is filed.
 *
 * ── The add/edit split ─────────────────────────────────────────────────────
 * `mode` exists because the two genuinely differ — an edit opens onto
 * populated fields and usually carries an extra destructive or resume action
 * — while everything around them is identical. Expenses already model this as
 * two components (`AddExpenseModal` / `EditExpenseModal`); here it is one
 * component and a prop, so the shell cannot drift between them.
 */
export function AddEditSheet({
  title,
  subtitle,
  mode = "add",
  onClose,
  children,
  /** The primary commit action. Omitted for a read-only or nav-only sheet. */
  primary,
  /** Extra actions on the footer's left, before Cancel — an edit's "remove",
   *  or a resume that leaves rather than commits. */
  secondary,
  cancelLabel = "Cancel",
  testId,
}: {
  title: string;
  subtitle?: string;
  mode?: "add" | "edit";
  onClose: () => void;
  children: React.ReactNode;
  primary?: { label: string; onClick: () => void; disabled?: boolean; pendingLabel?: string; pending?: boolean };
  secondary?: React.ReactNode;
  cancelLabel?: string;
  testId?: string;
}) {
  // Android back / browser back closes the sheet rather than leaving the page
  // — the same hook every hand-rolled copy of this already uses.
  useModalBackButton(onClose);

  return (
    <ScrollLock>
      {/* Tiered backdrop tokens — sheet (mobile) vs drawer (desktop). */}
      <div
        className="fixed inset-0 z-40 sm:hidden"
        style={{ background: "var(--color-bt-overlay-sheet)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-40 hidden sm:block"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        data-sheet-mode={mode}
        className={[
          "fixed z-50 flex flex-col",
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl",
          "sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-screen sm:max-h-screen sm:w-[440px] sm:rounded-none",
        ].join(" ")}
        style={{
          background: "var(--color-bt-card-float)",
          boxShadow: "var(--shadow-floating)",
          borderLeft: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — sticky top */}
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-4"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold" style={{ color: "var(--color-bt-text)" }}>
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-[12.5px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — the only scrolling region */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {/* Footer — sticky bottom */}
        <div
          className="flex flex-shrink-0 items-center gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
        >
          {secondary}
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            style={{
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text-dim)",
              background: "transparent",
            }}
          >
            {cancelLabel}
          </button>
          {primary && (
            <button
              onClick={primary.onClick}
              disabled={primary.disabled || primary.pending}
              data-testid={testId ? `${testId}-primary` : undefined}
              className="flex-1 rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
            >
              {primary.pending ? (primary.pendingLabel ?? "Saving…") : primary.label}
            </button>
          )}
        </div>
      </div>
    </ScrollLock>
  );
}
