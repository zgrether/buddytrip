"use client";

import { useEffect, useState } from "react";
import { BellOff, Share, Smartphone, X } from "lucide-react";
import {
  detectNotificationPermission,
  detectPlatform,
  detectStandalone,
  recordDismissal,
  recordVisit,
  resolveBannerState,
  readDismissal,
  type BannerState,
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
 *  - install/android — real one-tap Install via captured
 *    `beforeinstallprompt`; instructional fallback if Chrome hasn't
 *    offered the prompt.
 *  - install/ios — instructional only (iOS install cannot be triggered
 *    programmatically): Share → Add to Home Screen, share glyph inline.
 *  - blocked — installed but Notification.permission === "denied";
 *    informational (unfixable in-app) but deliberately not silent.
 *  - hidden — desktop, unengaged, dismissed-and-decaying, installed with
 *    permission granted, or installed with permission still "default"
 *    (that state stays stubbed until the push phase ships an enable
 *    action that actually does something).
 */

/** Chrome's install-prompt event — not in the TS DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallBanner() {
  const [state, setState] = useState<BannerState>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Capture Chrome's install prompt whenever it fires (often after this
    // mount). preventDefault suppresses Chrome's own mini-infobar so the
    // app controls when the prompt shows.
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setState(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Hydration-via-effect: the state depends on browser-only APIs (UA,
    // matchMedia, localStorage), so it MUST resolve after mount — the same
    // whitelisted case as useGuideDismissed / quick-game.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(
      resolveBannerState({
        platform: detectPlatform(),
        standalone: detectStandalone(),
        visits: recordVisit(),
        dismissal: readDismissal(),
        notificationPermission: detectNotificationPermission(),
        now: Date.now(),
      })
    );

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
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
    if (outcome === "accepted") {
      // Suppress the tab-context banner while the user moves to the
      // installed app (standalone detection owns the state from there).
      recordDismissal();
      setState(null);
    }
  };

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
            {state.platform === "ios" ? (
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
            ) : installPrompt ? null : (
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

      {/* Android one-tap install — Small Secondary (never a Primary fill). */}
      {state.kind === "install" && state.platform === "android" && installPrompt && (
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
