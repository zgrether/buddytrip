"use client";

import { Bell, BellOff } from "lucide-react";
import { useNotificationPreference } from "@/lib/useNotificationPreference";

/**
 * Chat notifications bell — the in-context toggle for the `chat` notification
 * preference (Push Phase 2). Lives inline with the ✕ in the chat header.
 *
 * ONE source of truth: it reads/writes `notifications.getPreferences` /
 * `setPreference` — the SAME stored `users.notification_prefs.chat` the
 * settings screen reads. No local pref state, so the header bell and the
 * settings control can never disagree. This is what makes the OFF-by-default
 * chat category safe: the switch is exactly where someone would look for it.
 *
 * The cache mechanics moved to `useNotificationPreference` when the `scores`
 * control landed, so one piece of code reads and writes every category. This is
 * a PURE refactor of this component — same query, same optimistic write, same
 * rollback, and the `?? false` fallback is now derived from the registry
 * (`chat.defaultOn === false`) rather than written out.
 *
 * Filled bell + accent = on; outline bell + dim = off.
 */
export function ChatNotifyToggle() {
  const { enabled: on, loading, toggle } = useNotificationPreference("chat");

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-label={on ? "Turn off chat notifications" : "Turn on chat notifications"}
      aria-pressed={on}
      title={on ? "Chat notifications on" : "Chat notifications off"}
      className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-50"
      style={{ color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
    >
      {on ? <Bell size={16} /> : <BellOff size={16} />}
    </button>
  );
}
