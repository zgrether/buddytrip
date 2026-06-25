"use client";

import { X } from "lucide-react";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * Sheet — the ONE overlay primitive. A focused editor/task that surfaces OVER a
 * still-present home (the lighter drawer scrim keeps the home readable behind it)
 * and dismisses back to it. This is the layered-surface model the navigation
 * system reuses one level up (leaderboard → game → scorecard); the config
 * checklist's editor overlays are that same model one level down — so this is the
 * shared primitive, not a one-off.
 *
 * Replaces the four bespoke copies of the same scrim+panel+dismiss skeleton
 * (RostersOverlay, DangerConfirmModal-ish, GameSheet, PlayerSelector). Bottom
 * sheet on mobile, centered card on desktop; `useScrollLock` (react-remove-scroll)
 * locks the body and stacks correctly when sheets nest. Dismiss = tap the scrim,
 * the ✕, or whatever the body calls `onClose` from.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testId,
  maxWidthClass = "max-w-lg",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional pinned footer (e.g. a commit CTA). */
  footer?: React.ReactNode;
  testId?: string;
  /** Panel max width (Tailwind class). Default max-w-lg; rosters wants max-w-3xl. */
  maxWidthClass?: string;
}) {
  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        data-testid={testId}
      >
        <div
          className={`flex max-h-[90vh] w-full ${maxWidthClass} flex-col rounded-t-2xl sm:rounded-2xl`}
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--color-bt-border)" }}
          >
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
                {title}
              </h3>
              {subtitle && (
                <p className="truncate text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">{children}</div>

          {/* Footer (optional) */}
          {footer && (
            <div className="border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </ScrollLock>
  );
}
