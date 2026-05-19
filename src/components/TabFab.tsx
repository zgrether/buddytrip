"use client";

import { Plus } from "lucide-react";
import type { ReactNode } from "react";

// ── Types ────────────────────────────────────────────────────────────────

interface TabFabProps {
  /** Click handler — typically the same add-action wired to the desktop button. */
  onClick: () => void;
  /** Accessible label, e.g. "Add receipt". */
  label: string;
  /** Icon to render inside the FAB. Defaults to a Plus glyph. */
  icon?: ReactNode;
  /** data-testid for E2E targeting. */
  testId?: string;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * TabFab — mobile-only floating action button for the entry tabs.
 *
 * On desktop the same add action lives inline in the TabHeader's eyebrow
 * row, so this FAB is `sm:hidden`. On mobile the header button would
 * either wrap awkwardly or slide off-screen on narrow viewports, so the
 * add affordance moves to a fixed bottom-right circle (Material Design
 * canonical pattern — always thumb-reachable regardless of scroll
 * position, doesn't compete with content density).
 *
 * Positioned in the right gutter with bottom-20 to clear the optional
 * TripBottomNav (~56px) plus iOS safe-area. The tab page already pads
 * pb-24 at the bottom so scrolled content can pass under the FAB.
 *
 * Render this at the bottom of each tab's JSX (after content). No portal
 * is needed because the trip-detail page chrome above doesn't create a
 * containing block for fixed descendants (the backdrop-filter header is
 * a sibling, not an ancestor).
 */
export function TabFab({ onClick, label, icon, testId }: TabFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="fixed right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full transition-opacity hover:opacity-90 active:scale-95 sm:hidden"
      style={{
        // 80px above the viewport bottom clears the optional comp BottomNav
        // (~56px) plus a 24px gap. iOS safe-area-inset is layered on so the
        // FAB doesn't tuck under the home indicator.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
        background: "var(--color-bt-accent)",
        color: "var(--color-bt-base)",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      {icon ?? <Plus size={22} strokeWidth={2.25} />}
    </button>
  );
}
