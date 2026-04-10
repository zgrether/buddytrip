"use client";

import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { getNotificationText, relativeTime } from "@/lib/notificationText";

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
}

const NOTIFICATION_ICONS: Record<string, typeof Bell> = {
  rsvp_response: UserCheck,
  destination_locked: MapPin,
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
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const handleBellClick = () => {
    setOpen((prev) => !prev);
    if (!open && onMarkAllRead && unreadCount > 0) onMarkAllRead();
  };

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center justify-between px-4"
      style={{ background: "var(--color-bt-card)", borderBottom: "1px solid var(--color-bt-border)" }}
    >
      <button
        onClick={() => router.push("/dashboard")}
        className="flex items-center gap-2 font-display font-semibold text-lg tracking-wider transition-opacity hover:opacity-80"
        style={{ color: "var(--color-bt-text)" }}
        aria-label="Go to dashboard"
      >
        <svg width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0, color: "var(--color-bt-accent)" }}>
          <path d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z" fill="currentColor"/>
        </svg>
        {title}
      </button>

      <div className="flex items-center gap-2">
        <div ref={ref} className="relative">
          <button
            aria-label="Notifications"
            data-testid="notification-bell"
            onClick={handleBellClick}
            className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
          >
            <Bell size={20} strokeWidth={1.5} />
            {unreadCount > 0 && (
              <span
                data-testid="notification-badge"
                className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-[10px] font-bold"
                style={{ background: "var(--color-bt-warning)", color: "#fff" }}
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
                className="overflow-hidden rounded-xl shadow-2xl z-50 fixed left-4 right-4 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-11"
                style={{
                  background: "var(--color-bt-card)",
                  border: "1px solid var(--color-bt-border)",
                  maxWidth: "min(380px, calc(100vw - 32px))",
                  width: undefined,
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
                {notifications.length === 0 ? (
                  <div
                    className="px-4 py-8 text-center text-[13px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    No notifications yet
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n, idx) => {
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
                          background: n.read ? "transparent" : "var(--color-bt-card-raised)",
                          borderBottom: idx < Math.min(notifications.length, 20) - 1
                            ? "0.5px solid var(--color-bt-border)"
                            : undefined,
                        }}
                      >
                        {!n.read ? (
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
                              color: n.read ? "var(--color-bt-text-dim)" : "var(--color-bt-text)",
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
                        <span
                          className="mt-0.5 flex-shrink-0 text-[11px] whitespace-nowrap"
                          style={{ color: "var(--color-bt-text-dim)" }}
                        >
                          {relativeTime(n.created_at)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              </div>
            </>
          )}
        </div>

        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
};
