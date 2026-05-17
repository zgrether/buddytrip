"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Bell } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { useGlobalNotifications } from "@/hooks/useGlobalNotifications";

/**
 * Notification preferences — placeholder until per-channel controls land.
 * Wired up so the profile page row navigates somewhere coherent and we
 * have a home for the real toggles later.
 */
export default function NotificationPreferencesPage() {
  const router = useRouter();
  const { notifications, unreadCount, markAllRead } = useGlobalNotifications();

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
      />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <button
          type="button"
          onClick={() => router.push("/profile")}
          className="mb-4 inline-flex items-center gap-1 text-sm hover:opacity-80"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <ArrowLeft size={14} /> Back to profile
        </button>
        <div
          className="flex flex-col items-center gap-3 rounded-xl px-6 py-10 text-center"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-card-raised)" }}
          >
            <Bell size={20} style={{ color: "var(--color-bt-accent)" }} />
          </div>
          <h1 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Notification preferences
          </h1>
          <p className="max-w-sm text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
            Per-channel controls (push, email, in-app) are on the roadmap.
            For now, all notification types are enabled by default.
          </p>
        </div>
      </main>
    </div>
  );
}
