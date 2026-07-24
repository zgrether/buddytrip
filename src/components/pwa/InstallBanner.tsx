"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Share, Smartphone, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { subscribeBrowser } from "@/lib/pushClient";
import {
  clearCapturedInstallPrompt,
  detectNotificationPermission,
  detectPlatform,
  detectStandalone,
  getCapturedInstallPrompt,
  installAffordance,
  isEngaged,
  recordDismissal,
  resolveBannerState,
  readDismissal,
  subscribePwaState,
  type BannerState,
  type BeforeInstallPromptEvent,
} from "@/lib/pwaInstall";

/**
 * PWA install / notification banner — a **transient system message** per the
 * STYLE_GUIDE pattern: full-bleed strip below the top app bar (TopNav's
 * sibling), chrome-style border, dismissible with decaying dismissal,
 * engagement-gated, one at a time.
 *
 * States (resolved in src/lib/pwaInstall.ts — pure + unit-tested):
 *  - install/android · install/ios — not installed; Android one-tap Install via
 *    the root-captured beforeinstallprompt (instructional Chrome-menu fallback),
 *    iOS instructional Share → Add to Home Screen.
 *  - enable — installed, Notification.permission === "default" AND push is
 *    configured: offer to turn on notifications. Requests permission + subscribes
 *    on the Enable tap (a USER GESTURE — never on load).
 *  - blocked — installed but permission === "denied": settings message
 *    (unfixable in-app, deliberately not silent).
 *  - hidden — desktop, unengaged, dismissed-and-decaying, granted, or default
 *    with push unconfigured.
 */
export function InstallBanner() {
  const [state, setState] = useState<BannerState>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [enabling, setEnabling] = useState(false);

  const pushStatus = trpc.notifications.status.useQuery(undefined, {
    staleTime: Infinity,
  });
  const subscribeMut = trpc.notifications.subscribe.useMutation();
  const pushConfigured = pushStatus.data?.configured ?? false;

  const syncState = useCallback(() => {
    setInstallPrompt(getCapturedInstallPrompt());
    setState(
      resolveBannerState({
        platform: detectPlatform(),
        standalone: detectStandalone(),
        engaged: isEngaged(),
        dismissal: readDismissal(),
        notificationPermission: detectNotificationPermission(),
        pushConfigured,
        now: Date.now(),
      })
    );
  }, [pushConfigured]);

  useEffect(() => {
    // Re-resolve on every PWA-state change (engagement flip, prompt
    // capture/clear) AND whenever push config resolves. Browser-only reads, so
    // this runs after mount, not during render.
    syncState();
    const unsubscribe = subscribePwaState(syncState);
    const onInstalled = () => setState(null);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      unsubscribe();
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [syncState]);

  if (!state) return null;

  const dismiss = () => {
    recordDismissal();
    setState(null);
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    // Single-use event: clear whatever the outcome so a DISMISSED prompt falls
    // back to the instructional copy, not a dead button.
    clearCapturedInstallPrompt();
    if (outcome === "accepted") {
      recordDismissal();
      setState(null);
    }
  };

  // Enable notifications — permission request on THIS user gesture, then
  // subscribe. Granted → banner hides (resolve → null); denied or an
  // Android-13 OS-level block → resolve → blocked (settings message).
  const enable = async () => {
    if (enabling) return;
    setEnabling(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        const sub = await subscribeBrowser();
        if (sub) await subscribeMut.mutateAsync(sub);
      }
    } catch {
      // Non-fatal — re-resolve surfaces the correct state below.
    } finally {
      setEnabling(false);
      syncState();
    }
  };

  const kind = state.kind;
  const affordance = installAffordance(state, installPrompt != null);

  // Icon + tone per state.
  const tone = kind === "blocked" ? "warning" : "accent";
  const Icon = kind === "blocked" ? BellOff : kind === "enable" ? Bell : Smartphone;

  return (
    <div
      data-testid="pwa-banner"
      data-state={kind}
      className="flex min-h-[44px] items-center gap-3 px-4 py-2.5"
      style={{
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background:
            tone === "warning"
              ? "var(--color-bt-warning-faint)"
              : "var(--color-bt-accent-faint)",
          color:
            tone === "warning" ? "var(--color-bt-warning)" : "var(--color-bt-accent)",
        }}
      >
        <Icon size={14} />
      </span>

      <div className="min-w-0 flex-1">
        {kind === "blocked" && (
          <p
            className="text-[13px] font-medium leading-snug"
            style={{ color: "var(--color-bt-text)" }}
          >
            Notifications are blocked — check your phone&apos;s settings
          </p>
        )}

        {kind === "enable" && (
          <>
            <p
              className="text-[13px] font-medium leading-snug"
              style={{ color: "var(--color-bt-text)" }}
            >
              Turn on notifications
            </p>
            <p
              className="mt-0.5 text-[11px] leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Get scores, results and cup alerts
            </p>
          </>
        )}

        {kind === "install" && (
          <>
            <p
              className="text-[13px] font-medium leading-snug"
              style={{ color: "var(--color-bt-text)" }}
            >
              Add BuddyTrip to your home screen
            </p>
            {affordance === "ios-instructions" && (
              <p
                className="mt-0.5 text-[11px] leading-snug"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Tap{" "}
                <Share size={11} className="inline align-[-1px]" aria-label="Share" />{" "}
                Share, then &ldquo;Add to Home Screen&rdquo;
              </p>
            )}
            {affordance === "android-instructions" && (
              <p
                className="mt-0.5 text-[11px] leading-snug"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                In Chrome&apos;s settings: Install and create shortcut
              </p>
            )}
          </>
        )}
      </div>

      {/* Android one-tap install — Small Secondary (never a Primary fill). */}
      {kind === "install" && affordance === "button" && (
        <button
          type="button"
          onClick={install}
          className="flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold"
          style={{
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text)",
            border: "0.5px solid var(--color-bt-border)",
          }}
        >
          Install
        </button>
      )}

      {/* Enable notifications — Small Secondary; requests permission on tap. */}
      {kind === "enable" && (
        <button
          type="button"
          onClick={enable}
          disabled={enabling}
          className="flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          style={{
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text)",
            border: "0.5px solid var(--color-bt-border)",
          }}
        >
          {enabling ? "…" : "Enable"}
        </button>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
