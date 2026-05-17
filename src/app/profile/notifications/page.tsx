"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { NotificationsPanel } from "@/components/profile/NotificationsPanel";
import { useGlobalNotifications } from "@/hooks/useGlobalNotifications";

/**
 * Dedicated mobile page — desktop renders the same panel inline inside
 * /profile when the Notifications sidebar tab is active.
 */
export default function NotificationsPage() {
  const { notifications, unreadCount, markAllRead } = useGlobalNotifications();
  return (
    <div className="min-h-screen" style={{ background: "var(--color-bt-base)" }}>
      <TopNav
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
      />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/profile"
          className="mb-4 inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ArrowLeft size={14} /> Back to profile
        </Link>
        <NotificationsPanel />
      </main>
    </div>
  );
}
