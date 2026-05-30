"use client";

import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  UserCheck,
  MapPin,
  CalendarCheck,
  CalendarDays,
  UserPlus,
  Send,
  ThumbsUp,
  FileText,
  MessageCircle,
} from "lucide-react";
import { IconLayoutGrid } from "@tabler/icons-react";
import { UserMenu } from "./UserMenu";
import { TripSwitcher } from "./TripSwitcher";
import { trpc } from "@/lib/trpc-client";
import { getNotificationText, relativeTime } from "@/lib/notificationText";
import { useChatUnreadCount } from "./FloatingChatPanel";

interface Notification {
  id: string;
  type: string;
  trip_id: string;
  created_at: string;
  read: boolean;
  payload?: Record<string, unknown>;
}

interface TopNavProps {
  title?: string;
  notifications?: Notification[];
  onMarkAllRead?: () => void;
  unreadCount?: number;
  /** When present, renders the crew-chat button with an unread badge driven
   *  by useChatUnreadCount(tripId). */
  tripId?: string;
  /** Opens the FloatingChatPanel. Required alongside tripId to show the chat
   *  button. */
  onOpenChat?: () => void;
  /** Reflects whether the FloatingChatPanel is currently open — used to
   *  render the chat button in its active state. */
  chatOpen?: boolean;
}

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  rsvp_response: UserCheck,
  destination_locked: MapPin,
  destination_changed: MapPin,
  dates_locked: CalendarCheck,
  date_poll_started: CalendarDays,
  crew_added: UserPlus,
  stage_advanced: Send,
  idea_voted: ThumbsUp,
  date_poll_voted: CalendarDays,
  about_update: FileText,
};

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  notifications = [],
  onMarkAllRead,
  unreadCount = 0,
  tripId,
  onOpenChat,
  chatOpen = false,
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Hide the trip switcher entirely when the user has no trips — the
  // empty-state hero already exposes "New trip" as the primary CTA, so
  // an extra switcher button just opens an empty panel. TanStack Query
  // dedupes against the same query the page may already be running.
  const { data: tripsForSwitcher } = trpc.trips.list.useQuery();
  const showSwitcher = (tripsForSwitcher?.length ?? 0) > 0;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Collapse duplicate notifications (same type + trip) into a single row.
  // Notifications arrive newest-first, so the first occurrence of each key
  // is always the most recent one to display.
  const groupedNotifications = useMemo(() => {
    const seen = new Map<string, { latest: Notification; count: number; hasUnread: boolean }>();
    for (const n of notifications) {
      const key = `${n.type}__${n.trip_id}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { latest: n, count: 1, hasUnread: !n.read });
      } else {
        seen.set(key, {
          latest: existing.latest,
          count: existing.count + 1,
          hasUnread: existing.hasUnread || !n.read,
        });
      }
    }
    return Array.from(seen.values());
  }, [notifications]);

  const handleBellClick = () => {
    setOpen((prev) => !prev);
    if (!open && onMarkAllRead && unreadCount > 0) onMarkAllRead();
  };

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

        <div ref={ref} className="relative">
          <button
            aria-label="Notifications"
            data-testid="notification-bell"
            onClick={handleBellClick}
            className="relative flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: open ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
          >
            <Bell size={20} strokeWidth={1.5} />
            {unreadCount > 0 && (
              <span
                data-testid="notification-badge"
                className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-[10px] font-bold"
                style={{ background: "var(--color-bt-warning)", color: "var(--color-bt-base-alt)" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {open && (
            <>
              {/* Mobile overlay backdrop */}
              <div
                className="fixed inset-0 z-40 sm:hidden"
                onClick={() => setOpen(false)}
              />
              <div
                data-testid="notification-dropdown"
                className="overflow-hidden rounded-xl shadow-2xl z-50 fixed right-4 top-14 w-[calc(100vw-32px)] max-w-[380px] sm:absolute sm:right-0 sm:top-11 sm:w-[380px]"
                style={{
                  background: "var(--color-bt-card)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: "1px solid var(--color-bt-border)" }}
                >
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--color-bt-text)" }}
                  >
                    Notifications
                  </span>
                  {onMarkAllRead && (
                    <button
                      onClick={() => onMarkAllRead()}
                      className="text-xs transition-colors hover:opacity-80"
                      style={{ color: "var(--color-bt-accent)" }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div
                  className="overflow-y-auto"
                  style={{ maxHeight: "min(480px, calc(100vh - 80px))" }}
                >
                {groupedNotifications.length === 0 ? (
                  <div
                    className="px-4 py-8 text-center text-[13px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    No notifications yet
                  </div>
                ) : (
                  groupedNotifications.slice(0, 20).map(({ latest: n, count, hasUnread }, idx) => {
                    const Icon = NOTIFICATION_ICONS[n.type] ?? Bell;
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          setOpen(false);
                          router.push(`/trips/${n.trip_id}`);
                        }}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                        style={{
                          background: hasUnread ? "var(--color-bt-card-raised)" : "transparent",
                          borderBottom: idx < Math.min(groupedNotifications.length, 20) - 1
                            ? "0.5px solid var(--color-bt-border)"
                            : undefined,
                        }}
                      >
                        {hasUnread ? (
                          <span
                            className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ background: "var(--color-bt-accent)" }}
                          />
                        ) : (
                          <span className="mt-1.5 h-2 w-2 flex-shrink-0" />
                        )}
                        <Icon
                          size={14}
                          className="mt-0.5 flex-shrink-0"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-[13px] leading-snug"
                            style={{
                              color: hasUnread ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              wordBreak: "break-word",
                            }}
                          >
                            {getNotificationText(n)}
                          </p>
                        </div>
                        <div className="ml-1 flex flex-shrink-0 flex-col items-end gap-1">
                          <span
                            className="text-[11px] whitespace-nowrap"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            {relativeTime(n.created_at)}
                          </span>
                          {count > 1 && (
                            <span
                              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                              style={{
                                background: "var(--color-bt-card-raised)",
                                color: "var(--color-bt-text-dim)",
                                border: "1px solid var(--color-bt-border)",
                              }}
                            >
                              ×{count}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              </div>
            </>
          )}
        </div>

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
