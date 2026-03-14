"use client";

import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Plus } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

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
  showAdd?: boolean;
  notifications?: Notification[];
  onMarkAllRead?: () => void;
  unreadCount?: number;
  /** Single character shown in the avatar button; omit to hide the button */
  avatarInitial?: string;
  onProfileClick?: () => void;
}

function notificationLabel(n: Notification): string {
  const type = n.type ?? "";
  if (type === "idea_added") return "New idea added";
  if (type === "member_joined") return "New member joined";
  if (type === "destination_locked") return "Destination locked!";
  if (type === "rsvp_updated") return "RSVP updated";
  if (type === "message_sent") return "New message";
  return "Trip update";
}

export const TopNav: FC<TopNavProps> = ({
  title = "BuddyTrip",
  showAdd = false,
  notifications = [],
  onMarkAllRead,
  unreadCount = 0,
  avatarInitial,
  onProfileClick,
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
      style={{ background: "var(--color-bt-base)", borderBottom: "1px solid var(--color-bt-border)" }}
    >
      <span className="text-lg font-bold" style={{ color: "var(--color-bt-accent)" }}>
        {title}
      </span>

      <div className="flex items-center gap-2">
        <ThemeToggle />

        {showAdd && (
          <button
            aria-label="New trip"
            onClick={() => router.push("/trips/new")}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
          >
            <Plus size={20} />
          </button>
        )}

        {avatarInitial && (
          <button
            aria-label="Profile"
            data-testid="profile-avatar-btn"
            onClick={onProfileClick}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors hover:opacity-80"
            style={{ background: "var(--color-bt-tag-bg)", color: "var(--color-bt-accent)" }}
          >
            {avatarInitial}
          </button>
        )}

        <div ref={ref} className="relative">
          <button
            aria-label="Notifications"
            data-testid="notification-bell"
            onClick={handleBellClick}
            className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text)" }}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span
                data-testid="notification-badge"
                className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {open && (
            <div
              data-testid="notification-dropdown"
              className="absolute right-0 top-11 w-80 overflow-hidden rounded-xl shadow-2xl"
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

              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div
                    className="px-4 py-8 text-center text-sm"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    No notifications yet
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setOpen(false);
                        router.push(`/trips/${n.trip_id}`);
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                    >
                      {!n.read && (
                        <span
                          className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ background: "var(--color-bt-accent)" }}
                        />
                      )}
                      {n.read && <span className="mt-1.5 h-2 w-2 flex-shrink-0" />}
                      <div className="min-w-0">
                        <p
                          className="truncate text-sm"
                          style={{ color: n.read ? "var(--color-bt-text-dim)" : "var(--color-bt-text)" }}
                        >
                          {notificationLabel(n)}
                        </p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          {new Date(n.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
