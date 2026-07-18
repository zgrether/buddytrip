"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * SettingsSlideOver — the shared shell for every game-settings surface
 * (match / rack / stroke / non-golf). Replaces the old in-page container (a
 * floating top save-bar over a page-header'd scroll region) with one full-page
 * slide-over: **full-page on mobile, a 440px right-anchored drawer on sm+**
 * (the crew/lodging trip-settings idiom).
 *
 * **Portaled to `document.body`** on purpose: the game panel host is
 * `position:fixed; z-30` (`CompetitionFace`), which caps every descendant's
 * z-index inside its own stacking context — a shell rendered *inside* it would sit
 * UNDER the z-40 top/bottom nav (the exact containing-block gotcha `RackGroupBuilder`'s
 * picker documents). Portaling to body escapes that, so the shell reliably covers the
 * nav — which also satisfies "bottom nav hidden while in settings" for free.
 * Scroll-locked via `react-remove-scroll` (wrapped INSIDE the portal, per the hook's
 * contract).
 *
 * Container ONLY — draft-then-save is unchanged. The body holds the settings content,
 * the pinned footer holds the shared `SettingsSaveBar`, and `onClose` (header ✕ / scrim
 * tap) routes through the caller's confirm-on-leave gate (`closeConfig`), so a dirty
 * close still raises the discard prompt (which portals to body at z-[60], above this).
 *
 * Surface: the panel is `--color-bt-base` (NOT `card-float`) so the settings rows —
 * `card`/`card-raised` — keep reading as raised on the page background, exactly as they
 * did in the old in-page container (STYLE_GUIDE §1 surface hierarchy).
 */
export function SettingsSlideOver({
  title,
  onClose,
  children,
  footer,
  testId,
}: {
  /** Header label — the game's (draft) name, for orientation while the nav is covered. */
  title: string;
  /** The confirm-gated close (header ✕ + scrim tap both route here). */
  onClose: () => void;
  children: React.ReactNode;
  /** The pinned-bottom commit row (the shared SettingsSaveBar). */
  footer: React.ReactNode;
  testId?: string;
}) {
  // Client-only (portal needs document); the overlay only ever mounts behind a user
  // interaction anyway. Matches AboutModal / FeedbackModal / RackGroupBuilder's picker.
  if (typeof document === "undefined") return null;
  return createPortal(
    <ScrollLock>
      {/* Scrim — dims the page behind; tap closes (relevant on the sm+ drawer; on
          mobile the full-page panel covers it). */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        aria-hidden
      />
      {/* Panel — full-page (mobile) / 440px right drawer (sm+). */}
      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        className="fixed inset-0 z-50 flex flex-col sm:left-auto sm:right-0 sm:top-0 sm:bottom-0 sm:w-[440px]"
        style={{ background: "var(--color-bt-base)", borderLeft: "1px solid var(--color-bt-border)" }}
      >
        {/* Header — game name + close. */}
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 px-4"
          style={{ height: 56, borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h2 className="min-w-0 truncate text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — the settings content scrolls here. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{children}</div>

        {/* Pinned footer — Save / Cancel. */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ borderTop: "1px solid var(--color-bt-border)", background: "var(--color-bt-base)" }}
        >
          {footer}
        </div>
      </div>
    </ScrollLock>,
    document.body
  );
}
