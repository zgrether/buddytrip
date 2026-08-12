"use client";

import { Calendar, Trophy, type LucideIcon } from "lucide-react";
import type { AppView } from "./useAppView";

/**
 * Trip · Cup, as a floating pill centred at the bottom of the content area.
 *
 * ── Why it left the title bar ───────────────────────────────────────────────
 * It was absolutely positioned in `TopNav` at the content area's left margin.
 * That alignment was correct and still collided: with the rail collapsed the
 * content area starts at 62 + 24 = 86px, which is inside the "BuddyTrip"
 * wordmark, so the group had to be floored against the identity zone and sat
 * visibly off its own alignment in exactly that state. There is no x in that bar
 * that is both aligned to the content and clear of the brand.
 *
 * Down here there is no neighbour to collide with at any rail width, which is
 * the whole reason the position works.
 *
 * ── Why a floating pill rather than a bottom bar ────────────────────────────
 * An edge-anchored bar would read as the mobile tab bar reappearing on desktop,
 * and it isn't one: Home is the rail on the left and Chat is a column on the
 * right, so this holds two items where mobile's holds four. Floating it clear of
 * the bottom edge says "this is a control over the content", not "this is the
 * frame". It is deliberately familiar in SHAPE to the mobile bar — same two
 * labels, same icons, same selected treatment — because it is the same choice;
 * it just isn't the same component and shouldn't pretend to be.
 *
 * ── Placement is the CONTENT AREA's, not the viewport's ─────────────────────
 * Rendered as a sibling of the scrolling body inside a positioned wrapper, so
 * it centres on the content column and stays put while that column scrolls. It
 * never overlaps the rail or the chat column, because it is inside neither.
 */

const TABS: { id: Exclude<AppView, "home">; label: string; Icon: LucideIcon }[] = [
  { id: "trip", label: "Trip", Icon: Calendar },
  { id: "cup", label: "Cup", Icon: Trophy },
];

export function ViewTabsPill({
  activeView,
  onSelectView,
}: {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Trip views"
      data-testid="view-tabs-pill"
      // `hidden lg:flex` — the mobile counterpart is `AppTabBar`, which also
      // carries Home and Chat. Two components rather than one because they hold
      // different sets, not because the same set needs two layouts.
      className="absolute bottom-6 left-1/2 z-30 hidden -translate-x-1/2 items-center gap-1 rounded-full p-1 lg:flex"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        boxShadow: "var(--shadow-floating)",
      }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = activeView === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`desktop-tab-${id}`}
            onClick={() => onSelectView(id)}
            // Selected is a filled lozenge rather than the underline the bar
            // used: an underline inside a pill reads as an underlined word, and
            // the shape has to carry the state now that there is no bar edge for
            // a border to sit on. Press + focus treatments match STYLE_GUIDE §5,
            // same values as every other control in this shell.
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold transition-[color,background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bt-accent)]"
            style={{
              background: selected ? "var(--color-bt-accent-faint)" : "transparent",
              color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
