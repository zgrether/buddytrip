"use client";

import { Bell, BellOff } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

/**
 * Chat notifications bell — the in-context toggle for the `chat` notification
 * preference (Push Phase 2). Lives inline with the ✕ in the chat header.
 *
 * ONE source of truth: it reads/writes `notifications.getPreferences` /
 * `setPreference` — the SAME stored `users.notification_prefs.chat` the future
 * settings screen reads. No local pref state, so the header bell and the
 * settings control can never disagree. This is what makes the OFF-by-default
 * chat category safe: the switch is exactly where someone would look for it.
 *
 * Filled bell + accent = on; outline bell + dim = off.
 */
export function ChatNotifyToggle() {
  const utils = trpc.useUtils();
  const prefs = trpc.notifications.getPreferences.useQuery(undefined, {
    staleTime: 60_000,
  });
  const setPref = trpc.notifications.setPreference.useMutation({
    async onMutate({ key, enabled }) {
      await utils.notifications.getPreferences.cancel();
      const prev = utils.notifications.getPreferences.getData();
      if (prev) {
        utils.notifications.getPreferences.setData(undefined, {
          ...prev,
          [key]: enabled,
        });
      }
      return { prev };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.prev) utils.notifications.getPreferences.setData(undefined, ctx.prev);
    },
    onSettled() {
      utils.notifications.getPreferences.invalidate();
    },
  });

  // Until prefs load, assume the registry default (chat OFF) so the bell never
  // flashes the wrong state.
  const on = prefs.data?.chat ?? false;

  const toggle = () => setPref.mutate({ key: "chat", enabled: !on });

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={prefs.isLoading}
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
