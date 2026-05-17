"use client";

import { Bell } from "lucide-react";

/**
 * Notification-preferences body. Per-channel toggles (push/email/in-app)
 * are roadmap; for now we just show a clear placeholder card so the
 * route exists and the sidebar tab + mobile row both navigate somewhere
 * coherent.
 */
export function NotificationsPanel() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold" style={{ color: "var(--color-bt-text)" }}>
        Notifications
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
        Manage what alerts you receive across push, email, and in-app channels.
      </p>

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
        <p className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Per-channel controls coming soon
        </p>
        <p className="max-w-sm text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          All notification types are currently enabled. Granular toggles are on the roadmap.
        </p>
      </div>
    </div>
  );
}
