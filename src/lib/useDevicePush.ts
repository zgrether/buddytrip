"use client";

import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { showToast } from "@/lib/toast";
import {
  subscribeBrowser,
  unsubscribeBrowser,
  currentPushEndpoint,
  getVapidPublicKey,
} from "@/lib/pushClient";
import {
  deriveDevicePushState,
  devicePushCopy,
  type DevicePushState,
  type DevicePushCopy,
} from "@/lib/devicePushState";
import { isUnauthorizedError } from "@/lib/authExpiry";

/**
 * THIS DEVICE's push subscription — the three states the app can read, and the
 * one act that changes them.
 *
 * Extracted from the profile row it used to live inside, because the category
 * list has to render only when the device is subscribed: muting a category
 * without a subscription is meaningless, so the device state now has a SECOND
 * consumer. Two components deriving "is this device on" independently is how
 * they end up disagreeing on the same screen.
 *
 * The state model, the copy, and why `on` needs all three inputs live in
 * `devicePushState.ts`. This hook is the wiring: read the browser, read the
 * server, act, re-read.
 */
export interface DevicePushControl {
  state: DevicePushState;
  copy: DevicePushCopy;
  /** True while the browser/server reads are still resolving. */
  settling: boolean;
  busy: boolean;
  toggle: () => void;
}

export function useDevicePush(): DevicePushControl {
  const [busy, setBusy] = useState(false);
  // Both start unresolved because both are async and neither is knowable during
  // SSR — the caller shows a neutral state until they land rather than guessing
  // and correcting itself a tick later.
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [probed, setProbed] = useState(false);

  const subscribe = trpc.notifications.subscribe.useMutation();
  const unsubscribe = trpc.notifications.unsubscribe.useMutation();

  // Only meaningful once we HAVE an endpoint; `enabled` keeps it from firing
  // with a placeholder and caching a false negative against the wrong key.
  const registered = trpc.notifications.isRegistered.useQuery(
    { endpoint: endpoint ?? "" },
    { enabled: !!endpoint }
  );

  const readBrowserState = useCallback(async () => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      setProbed(true);
      return;
    }
    setPermission(Notification.permission);
    setEndpoint(await currentPushEndpoint());
    setProbed(true);
  }, []);

  useEffect(() => {
    void readBrowserState();
    // Permission and subscription can BOTH change outside this tab — revoked in
    // browser settings, or unsubscribed from another tab. Re-read on return so
    // the label is right after a reload or a trip to settings.
    const onVisible = () => {
      if (document.visibilityState === "visible") void readBrowserState();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [readBrowserState]);

  const state = deriveDevicePushState({
    supported:
      typeof window !== "undefined" &&
      typeof Notification !== "undefined" &&
      "serviceWorker" in navigator &&
      !!getVapidPublicKey(),
    permission,
    hasBrowserSubscription: !!endpoint,
    // While the query is in flight, treat it as NOT registered rather than
    // optimistically on — an over-claiming label is the defect this fixed.
    registeredOnServer: registered.data?.registered ?? false,
  });

  const copy = devicePushCopy(state);
  const settling = !probed || (!!endpoint && registered.isPending);

  /** Never surface a raw UNAUTHORIZED here — it reads as a broken button when it
   *  means a dead session, and it is the one message that must say what to do. */
  const failed = (fallback: string) => (err: unknown) => {
    showToast(
      isUnauthorizedError(err)
        ? "Your session expired — sign in again to change this."
        : fallback
    );
  };

  const toggle = async () => {
    if (busy || !copy.actionable) return;
    setBusy(true);
    try {
      if (state === "on") {
        // OFF means genuinely off: drop the browser subscription AND the row. A
        // preference flip would leave this device subscribed and is a different
        // act entirely.
        const removed = await unsubscribeBrowser();
        // Fall back to the endpoint already read, so a browser-side unsubscribe
        // returning null still clears the server row rather than stranding it as
        // a permanent phantom device.
        const target = removed ?? endpoint;
        if (target) await unsubscribe.mutateAsync({ endpoint: target });
        showToast("Notifications turned off for this device.", "info");
      } else {
        const perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== "granted") {
          // `denied` re-renders into the blocked state, which carries the
          // settings instruction — so the toast doesn't repeat it.
          showToast(
            perm === "denied"
              ? "Notifications are blocked for this site."
              : "Notifications weren't enabled.",
            "info"
          );
          return;
        }
        const sub = await subscribeBrowser();
        if (!sub) {
          showToast(
            "Couldn't subscribe on this device — try reopening BuddyTrip from your Home Screen.",
            "info"
          );
          return;
        }
        await subscribe.mutateAsync(sub);
        showToast("Notifications enabled on this device.", "info");
      }
      // Re-read rather than assume the write landed: the label's whole job is to
      // report reality, so it re-derives from the browser and the server.
      await readBrowserState();
      await registered.refetch();
    } catch (err) {
      failed(state === "on" ? "Couldn't turn notifications off." : "Couldn't enable notifications.")(
        err
      );
    } finally {
      setBusy(false);
    }
  };

  return { state, copy, settling, busy, toggle: () => void toggle() };
}
