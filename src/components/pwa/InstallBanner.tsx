"use client";

import { useEffect, useState } from "react";
import { BellOff, Share, Smartphone, X } from "lucide-react";
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
 * PWA install / notification-state banner (Phase 1) — a **transient
 * system message** per the STYLE_GUIDE pattern: full-bleed strip in
 * normal flow directly below the top app bar (mounted as TopNav's
 * sibling, so it scrolls away and never covers content), chrome-style
 * border separation, required dismiss with persisted decaying
 * dismissal, engagement-gated, one at a time.
 *
 * States (resolved in src/lib/pwaInstall.ts — pure + unit-tested):
 *  - install/android — real one-tap Install via the root-captured
 *    `beforeinstallprompt` (src/lib/pwaInstall.ts); instructional Chrome-menu
 *    fallback whenever no prompt is available (never fired, or consumed by a
 *    prior dismissal — the common post-dismiss state).
 *  - install/ios — instructional only (iOS install cannot be triggered
 *    programmatically): Share → Add to Home Screen, share glyph inline.
 *  - blocked — installed but Notification.permission === "denied";
 *    informational (unfixable in-app) but deliberately not silent.
 *  - hidden — desktop, unengaged, dismissed-and-decaying, installed with
 *    permission granted, or installed with permission still "default"
 *    (that state stays stubbed until the push phase ships an enable
 *    action that actually does something).
 *
 * The prompt is captured at app root BEFORE hydration (the banner mounts too
 * late to catch it itself); this component reads it from the store and
 * subscribes so a prompt that arrives after mount still lights up the button.
 */

export function InstallBanner() {
  const [state, setState] = useState<BannerState>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Re-resolve BOTH the visibility state and the captured prompt on every
    // PWA-state change (engagement flip, prompt capture/clear) so a banner that
    // mounted before the user engaged still appears once they do. Values depend
    // on browser-only APIs (UA, matchMedia, storage, window global), so this
    // resolves after mount, not during render.
    const sync = () => {
      setInstallPrompt(getCapturedInstallPrompt());
      setState(
        resolveBannerState({
          platform: detectPlatform(),
          standalone: detectStandalone(),
          engaged: isEngaged(),
          dismissal: readDismissal(),
          notificationPermission: detectNotificationPermission(),
          now: Date.now(),
        })
      );
    };
    sync();
    const unsubscribe = subscribePwaState(sync);
    const onInstalled = () => setState(null);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      unsubscribe();
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!state) return null;

  const dismiss = () => {
    recordDismissal();
    setState(null);
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    // The event is single-use whatever the outcome — clear it so a DISMISSED
    // prompt falls back to the instructional copy instead of a dead button
    // (Chrome won't re-fire beforeinstallprompt for a long window). The store
    // notifies subscribers, so this component's installPrompt goes null.
    clearCapturedInstallPrompt();
    if (outcome === "accepted") {
      // Suppress the tab-context banner while the user moves to the
      // installed app (standalone detection owns the state from there).
      recordDismissal();
      setState(null);
    }
  };

  const affordance = installAffordance(state, installPrompt != null);
  const blocked = state.kind === "blocked";

  return (
    <div
      data-testid="pwa-banner"
      className="flex min-h-[44px] items-center gap-3 px-4 py-2.5"
      style={{
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: blocked
            ? "var(--color-bt-warning-faint)"
            : "var(--color-bt-accent-faint)",
          color: blocked ? "var(--color-bt-warning)" : "var(--color-bt-accent)",
        }}
      >
        {blocked ? <BellOff size={14} /> : <Smartphone size={14} />}
      </span>

      <div className="min-w-0 flex-1">
        {blocked ? (
          <p
            className="text-[13px] font-medium leading-snug"
            style={{ color: "var(--color-bt-text)" }}
          >
            Notifications are blocked — check your phone&apos;s settings
          </p>
        ) : (
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
                <Share
                  size={11}
                  className="inline align-[-1px]"
                  aria-label="Share"
                />{" "}
                Share, then &ldquo;Add to Home Screen&rdquo;
              </p>
            )}
            {affordance === "android-instructions" && (
              <p
                className="mt-0.5 text-[11px] leading-snug"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                In Chrome: menu ⋮ → &ldquo;Add to Home screen&rdquo;
              </p>
            )}
          </>
        )}
      </div>

      {/* Android one-tap install — Small Secondary (never a Primary fill).
          Only when a live prompt is captured; otherwise the instructional
          copy above carries the how-to. */}
      {affordance === "button" && (
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
