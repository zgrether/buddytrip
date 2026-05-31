"use client";

import type { FC } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { IconLayoutGrid } from "@tabler/icons-react";
import { UserMenu } from "./UserMenu";
import { TripSwitcher } from "./TripSwitcher";
import { trpc } from "@/lib/trpc-client";
import { useChatUnreadCount } from "./FloatingChatPanel";

interface TopNavProps {
  title?: string;
  /** When present, renders the crew-chat button with an unread badge driven
   *  by useChatUnreadCount(tripId). */
  tripId?: string;
  /** Opens the FloatingChatPanel. Required alongside tripId to show the chat
   *  button. */
  onOpenChat?: () => void;
  /** Reflects whether the FloatingChatPanel is currently open — used to
   *  render the chat button in its active state. */
  chatOpen?: boolean;
  /** Hide the trip-switcher grid button (e.g. on the profile page, which
   *  isn't trip-scoped and doesn't need trip navigation). */
  hideTripSwitcher?: boolean;
}

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  tripId,
  onOpenChat,
  chatOpen = false,
  hideTripSwitcher = false,
}) => {
  const router = useRouter();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Hide the trip switcher entirely when the user has no trips — the
  // empty-state hero already exposes "New trip" as the primary CTA, so
  // an extra switcher button just opens an empty panel. TanStack Query
  // dedupes against the same query the page may already be running.
  const { data: tripsForSwitcher } = trpc.trips.list.useQuery(undefined, {
    enabled: !hideTripSwitcher,
  });
  const showSwitcher = !hideTripSwitcher && (tripsForSwitcher?.length ?? 0) > 0;

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center justify-between px-6"
      style={{
        background: "var(--color-bt-nav-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-[7px] text-[18px] font-semibold transition-opacity hover:opacity-80"
        style={{ color: "var(--color-bt-text)", letterSpacing: "0.06em" }}
        aria-label="Go to dashboard"
      >
        <svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0, color: "var(--color-bt-accent)" }}>
          <path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="currentColor"/>
        </svg>
        {title}
      </button>

      <div className="relative flex items-center gap-2">
        {/* Trip switcher trigger + panel — rendered only when the user
            has at least one trip. With no trips the panel would just
            show "New trip" / "View all trips" links which are already
            exposed elsewhere (the empty-state hero CTA + Dashboard). */}
        {showSwitcher && (
          <>
            <button
              type="button"
              aria-label="My trips"
              aria-haspopup="dialog"
              aria-expanded={switcherOpen}
              data-testid="trip-switcher-trigger"
              data-trip-switcher-trigger="true"
              onClick={() => setSwitcherOpen((p) => !p)}
              className="relative flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                color: switcherOpen
                  ? "var(--color-bt-accent)"
                  : "var(--color-bt-text-dim)",
              }}
            >
              <IconLayoutGrid size={20} stroke={1.5} />
            </button>
            <TripSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
          </>
        )}

        {tripId && onOpenChat && (
          <ChatButton tripId={tripId} onClick={onOpenChat} isOpen={chatOpen} />
        )}

        <UserMenu />
      </div>
    </header>
  );
};

// ── ChatButton ───────────────────────────────────────────────────────────────
// Isolated sub-component so the useChatUnreadCount hook only mounts on trip
// pages where a tripId is present. Mirrors the notification bell's shape,
// hover, and badge treatment.

function ChatButton({ tripId, onClick, isOpen }: { tripId: string; onClick: () => void; isOpen: boolean }) {
  const unread = useChatUnreadCount(tripId);
  return (
    <button
      aria-label="Open crew chat"
      data-testid="chat-button"
      onClick={onClick}
      className={`relative flex h-8 w-8 items-center justify-center transition-colors ${isOpen ? "rounded-lg" : "rounded-full hover:bg-[var(--color-bt-hover)]"}`}
      style={
        isOpen
          ? { color: "var(--color-bt-accent)", background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }
          : { color: "var(--color-bt-text-dim)" }
      }
    >
      <MessageCircle size={20} strokeWidth={1.5} />
      {unread > 0 && (
        <span
          data-testid="chat-unread-badge"
          className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-[10px] font-bold"
          style={{ background: "var(--color-bt-warning)", color: "var(--color-bt-base-alt)" }}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
