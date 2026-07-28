"use client";

import { type FC } from "react";
import { Calendar, Trophy, MessageCircle, type LucideIcon } from "lucide-react";
import { useChatTabUnread } from "@/hooks/useChatTabUnread";
import type { AppView } from "./useAppView";

/**
 * DesktopTabStrip — Trip · Cup · Chat as content tabs above the content area
 * (Phase 5). Home is not here: on desktop it is the persistent rail.
 *
 * `hidden lg:flex`, the mirror of `AppTabBar`'s `lg:hidden`. Both render from the
 * SAME `view` state and the same `onSelect`, so a URL renders identically in
 * either viewport and crossing the breakpoint swaps only which chrome is
 * visible — the content tree beneath is untouched.
 *
 * Underline rather than the bottom bar's icon-over-label: this sits directly on
 * the content, so per STYLE_GUIDE §1 it is contextual page structure, not chrome
 * — it takes the page background and a border, not the chrome surface.
 */

const TABS: { id: Exclude<AppView, "home">; label: string; Icon: LucideIcon }[] = [
  { id: "trip", label: "Trip", Icon: Calendar },
  { id: "cup", label: "Cup", Icon: Trophy },
  { id: "chat", label: "Chat", Icon: MessageCircle },
];

export const DesktopTabStrip: FC<{
  active: AppView;
  hasContext: boolean;
  onSelect: (view: AppView) => void;
  onLockedTap: (view: Exclude<AppView, "home">) => void;
  /** Drives the Chat tab's unread badge. Null on the context-free host. */
  tripId?: string | null;
}> = ({ active, hasContext, onSelect, onLockedTap, tripId }) => {
  const chatUnread = useChatTabUnread(tripId ?? undefined);
  return (
    <div
      role="tablist"
      className="hidden h-[46px] shrink-0 items-stretch gap-0.5 px-4 lg:flex"
      style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      data-testid="desktop-tab-strip"
    >
      {TABS.map(({ id, label, Icon }) => {
        const locked = !hasContext;
        const selected = active === id;
        const showBadge = id === "chat" && !locked && chatUnread > 0;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-disabled={locked || undefined}
            data-testid={`desktop-tab-${id}`}
            data-locked={locked || undefined}
            onClick={() => (locked ? onLockedTap(id) : onSelect(id))}
            className="flex items-center gap-1.5 px-4 text-[13.5px] font-semibold transition-colors"
            style={{
              background: "transparent",
              border: 0,
              borderBottom: `2px solid ${selected ? "var(--color-bt-accent)" : "transparent"}`,
              color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              opacity: locked ? 0.45 : 1,
            }}
          >
            <Icon size={16} />
            {label}
            {showBadge && (
              <span
                aria-hidden="true"
                data-testid="desktop-tab-chat-badge"
                className="rounded-full"
                style={{ width: 6, height: 6, background: "var(--color-bt-owner)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
