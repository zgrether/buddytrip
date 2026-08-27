"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";
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
 *
 * ── PORTALS TO BODY, and this is load-bearing ───────────────────────────────
 *
 * `z-50` is only worth anything at the TOP LEVEL. Rendered inline, a Sheet
 * inherits whatever stacking context its ancestors set — and every game surface
 * lives inside `CompetitionFace`'s game panel, which is `fixed … z-30`. A
 * `position:fixed` element carrying a z-index creates a stacking context, so the
 * Sheet's `z-50` was capped *inside* z-30: correct relative to its siblings, and
 * underneath anything genuinely at z-40 or z-50.
 *
 * What that produced: the pick'em slate opened UNDERNEATH the settings
 * slide-over, which portals to body and therefore holds a real z-50. The Sheet
 * was in the DOM, `visible`, non-zero opacity, correct size — and completely
 * covered. So "The slate" read as a dead button, nothing errored, and a check
 * that the modal had RENDERED passed, because it had. `elementFromPoint` at the
 * modal's own centre is what actually caught it.
 *
 * `SettingsSlideOver` already portals for exactly this reason, and its own
 * comment names the trap: "`position:fixed; z-30` (`CompetitionFace`), which
 * caps every descendant's [stacking]". The shared primitive had not learned it —
 * which made the line above, "stacks correctly when sheets nest", true only for
 * sheets that happened not to nest under a stacking context.
 *
 * A portal moves the DOM node, not the React tree: context, state and event
 * bubbling through React are unchanged.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testId,
  maxWidthClass = "max-w-lg",
  bodyClassName = "p-4",
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
  /** Body padding/utility classes. Default `p-4`; a full-bleed body (e.g. the
   *  scorecard grid, which manages its own horizontal scroll + sticky column)
   *  passes `p-0`. Always keeps `flex-1 overflow-y-auto`. */
  bodyClassName?: string;
}) {
  const tree = (
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
          <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

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

  /**
   * Portal only where there IS a document.
   *
   * NOT `if (typeof document === "undefined") return null` — the guard
   * `SettingsSlideOver` uses. That is correct for a component nothing renders
   * off-browser, and wrong here: `Sheet`'s consumers are covered by
   * `renderToStaticMarkup` tests in a `node` environment (no jsdom), so
   * returning null would have silently emptied every one of them. It did —
   * 25 assertions in `PickemSlateModal.test.tsx` went red in one go, which is
   * the good version of that mistake.
   *
   * Rendering the tree inline off-browser cannot produce a hydration mismatch,
   * because a Sheet is never open during a real server render: `open` starts
   * false in every consumer and is only ever set by an interaction.
   */
  return typeof document === "undefined" ? tree : createPortal(tree, document.body);
}
