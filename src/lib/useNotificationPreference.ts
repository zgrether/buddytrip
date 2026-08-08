"use client";

import { trpc } from "@/lib/trpc-client";
import { notificationDefault, type NotificationKey } from "@/lib/notificationTypes";

/**
 * Read/write ONE notification category preference.
 *
 * ── Why a hook and not a second toggle ──────────────────────────────────────
 * `ChatNotifyToggle` already owned this: the `getPreferences` query, the
 * optimistic `setData` on mutate, the snapshot restore on error, the invalidate
 * on settle. Adding a `scores` control by copying that block would make two
 * cache-manipulating code paths over one stored value — the shape CLAUDE.md #22
 * names directly ("one invalidator, not two lists that happen to match"), and
 * the delta between them IS the bug when they drift.
 *
 * So the mechanism moved here and both callers use it. There is still exactly
 * ONE source of truth for a preference — `users.notification_prefs` via
 * `notifications.getPreferences` / `setPreference` — and now exactly one piece
 * of code that reads and writes it.
 *
 * ── The default matters, and is derived ─────────────────────────────────────
 * Before the query resolves, the value falls back to the REGISTRY default
 * (`notificationDefault`), not to a literal. `scores` defaults ON and `chat`
 * defaults OFF, so a hardcoded `?? false` would render `scores` as off for the
 * ~200ms before prefs land — showing every user, correctly opted in, a switch
 * that says they are not. Deriving it from the registry makes the fallback
 * right for every key by construction, including keys added later.
 */
export interface NotificationPreferenceControl {
  /** Effective value: stored if set, else the registry default. */
  enabled: boolean;
  /** True until the stored preferences have loaded at least once. */
  loading: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  toggle: () => void;
}

export function useNotificationPreference(
  key: NotificationKey
): NotificationPreferenceControl {
  const utils = trpc.useUtils();
  const prefs = trpc.notifications.getPreferences.useQuery(undefined, {
    staleTime: 60_000,
  });

  const setPref = trpc.notifications.setPreference.useMutation({
    async onMutate({ key: mutatedKey, enabled }) {
      await utils.notifications.getPreferences.cancel();
      const prev = utils.notifications.getPreferences.getData();
      if (prev) {
        utils.notifications.getPreferences.setData(undefined, {
          ...prev,
          [mutatedKey]: enabled,
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

  const enabled = prefs.data?.[key] ?? notificationDefault(key);

  return {
    enabled,
    loading: prefs.isLoading,
    saving: setPref.isPending,
    toggle: () => setPref.mutate({ key, enabled: !enabled }),
  };
}
