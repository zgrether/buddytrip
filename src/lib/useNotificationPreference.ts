"use client";

import { trpc } from "@/lib/trpc-client";
import { notificationDefault, type NotificationKey } from "@/lib/notificationTypes";

/**
 * Read/write ONE notification category preference.
 *
 * ── Why a hook ──────────────────────────────────────────────────────────────
 * The chat header bell used to own this: the `getPreferences` query, the
 * optimistic `setData` on mutate, the snapshot restore on error, the invalidate
 * on settle. Adding a second control by copying that block would have made two
 * cache-manipulating code paths over one stored value — the shape CLAUDE.md #22
 * names directly ("one invalidator, not two lists that happen to match"), and
 * the delta between them IS the bug when they drift.
 *
 * The bell has since been REMOVED — one stored value with two entry points is
 * the same divergence in the UI layer, and someone who muted from the bell had
 * no way to know settings governed the same thing. Notification settings now
 * live in exactly one place, and this is the one piece of code that reads and
 * writes a preference.
 *
 * ── The default matters, and is derived ─────────────────────────────────────
 * Before the query resolves, the value falls back to the REGISTRY default
 * (`notificationDefault`), not to a literal. EVERY category now defaults ON, so
 * a hardcoded `?? false` would render every switch as off for the ~200ms before
 * prefs land — showing every user, correctly opted in, a control that says they
 * are not. Deriving it from the registry makes the fallback right for every key
 * by construction, including keys added later.
 *
 * The literal this replaced was `?? false`, inherited from when `chat` was the
 * only caller and defaulted OFF. It was correct exactly once, for one key, and
 * silently wrong for the next one.
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
