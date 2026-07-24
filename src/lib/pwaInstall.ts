/**
 * PWA install-banner state (PWA Phase 1) — pure, client-safe decision
 * logic. The banner component feeds detected facts in; this module owns
 * WHEN a transient system message shows and which one, per the
 * STYLE_GUIDE pattern rules (engagement gating, decaying dismissal,
 * one-at-a-time, never desktop).
 *
 * All functions are pure (storage reads/writes live in the thin
 * wrappers at the bottom) so the state machine is unit-testable in
 * node without a DOM.
 */

export type PwaPlatform = "ios" | "android" | "other";

export type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

export interface DismissalRecord {
  /** Epoch ms of the most recent dismissal. */
  at: number;
  /** How many times the banner has been dismissed, ever. */
  count: number;
}

export type BannerState =
  | { kind: "install"; platform: "ios" | "android" }
  | { kind: "blocked" }
  | null;

/** Which install affordance the banner renders, given the resolved state and
 *  whether a live `beforeinstallprompt` is captured. Pure so the render branch
 *  (esp. the Android no-prompt fallback — the common state after a dismissal)
 *  is unit-testable without a DOM. */
export type InstallAffordance =
  | "button" // Android with a captured prompt → real one-tap Install
  | "android-instructions" // Android, no prompt available → Chrome ⋮ menu copy
  | "ios-instructions" // iOS → Share → Add to Home Screen (never a button)
  | "none"; // blocked/hidden — no install affordance

export function installAffordance(
  state: BannerState,
  hasPrompt: boolean
): InstallAffordance {
  if (!state || state.kind !== "install") return "none";
  if (state.platform === "ios") return "ios-instructions";
  return hasPrompt ? "button" : "android-instructions";
}

/** Show only from the Nth visit — a banner before the user has seen the
 *  app gets reflex-dismissed. */
export const MIN_VISITS = 3;
/** Post-dismissal suppression window (~2 weeks). */
export const DISMISS_DECAY_MS = 14 * 24 * 60 * 60 * 1000;
/** After this many dismissals the banner never returns (it "may return
 *  once" after the first decay — a second dismissal is final). */
export const MAX_DISMISSALS = 2;

/** True while a dismissal suppresses the banner. */
export function isDismissSuppressed(
  dismissal: DismissalRecord | null,
  now: number
): boolean {
  if (!dismissal) return false;
  if (dismissal.count >= MAX_DISMISSALS) return true;
  return now - dismissal.at < DISMISS_DECAY_MS;
}

/**
 * The banner state machine. Branch order is priority order — install is
 * the foundation, so it wins over permission states; the
 * installed-but-permission-default state is deliberately silent until
 * the push phase ships something the enable button can actually do.
 */
export function resolveBannerState(input: {
  platform: PwaPlatform;
  standalone: boolean;
  visits: number;
  dismissal: DismissalRecord | null;
  notificationPermission: NotificationPermissionState;
  now: number;
}): BannerState {
  const { platform, standalone, visits, dismissal, notificationPermission, now } = input;

  // Desktop / unknown platforms never see the banner.
  if (platform === "other") return null;
  // Engagement gate — never on the first couple of loads.
  if (visits < MIN_VISITS) return null;
  // Decaying dismissal.
  if (isDismissSuppressed(dismissal, now)) return null;

  if (!standalone) return { kind: "install", platform };

  // Installed. Denied must not be silent (top future support ticket);
  // "default" stays hidden until push exists to enable; granted = done.
  if (notificationPermission === "denied") return { kind: "blocked" };
  return null;
}

// ── beforeinstallprompt capture (root-level, earliest possible) ──────────
//
// `beforeinstallprompt` fires early in page load — before React hydrates,
// long before the late-mounting TopNav that hosts the banner. A listener
// added in the banner's own effect routinely MISSES it, so the Android
// real-Install button never appears. Instead a tiny inline script
// (INSTALL_CAPTURE_SCRIPT, injected beforeInteractive in the root layout)
// owns the ONLY real listeners and stashes the event on a window global;
// the banner reads it from here and subscribes for late arrivals.

/** Chrome's install-prompt event — not in the TS DOM lib. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** window global + notification event name — MUST match the literals baked
 *  into INSTALL_CAPTURE_SCRIPT below (that script runs before this module). */
const BIP_GLOBAL = "__btInstallPrompt";
const BIP_EVENT = "bt:installprompt";

interface BipWindow {
  [BIP_GLOBAL]?: BeforeInstallPromptEvent | null;
}

/**
 * Inline capture script, injected `beforeInteractive` from the root layout so
 * it runs before hydration and can't miss the event. Captures + preventDefaults
 * `beforeinstallprompt` (letting us choose when to prompt), clears on
 * `appinstalled`, and re-broadcasts both as a `bt:installprompt` event the
 * React store subscribes to. Kept string-literal (not the typed helpers below)
 * because it executes standalone in the document, before any module loads.
 */
export const INSTALL_CAPTURE_SCRIPT = `
(function(){
  window.${BIP_GLOBAL} = null;
  function notify(){ window.dispatchEvent(new Event('${BIP_EVENT}')); }
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    window.${BIP_GLOBAL} = e;
    notify();
  });
  window.addEventListener('appinstalled', function(){
    window.${BIP_GLOBAL} = null;
    notify();
  });
})();
`;

/** The earliest-captured install prompt, or null if none is available
 *  (never fired, already consumed, or Chrome is suppressing it post-dismiss). */
export function getCapturedInstallPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as BipWindow)[BIP_GLOBAL] ?? null;
}

/** Subscribe to capture/clear changes (fired by the inline script + on consume). */
export function subscribeInstallPrompt(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(BIP_EVENT, cb);
  return () => window.removeEventListener(BIP_EVENT, cb);
}

/** Clear the captured prompt after `prompt()` resolves — the event is
 *  single-use (dismissed OR accepted), so a stale reference would leave a dead
 *  Install button. Clearing makes the banner fall back to the instructional
 *  copy. Notifies subscribers. */
export function clearCapturedInstallPrompt(): void {
  if (typeof window === "undefined") return;
  (window as unknown as BipWindow)[BIP_GLOBAL] = null;
  window.dispatchEvent(new Event(BIP_EVENT));
}

// ── Environment detection (browser-only; callers guard for SSR) ──────────

/** Home-screen / installed detection. `navigator.standalone` is the
 *  legacy iOS signal; display-mode covers Android + modern iOS. */
export function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (navigator as { standalone?: boolean }).standalone === true;
}

export function detectPlatform(): PwaPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh; the touch check separates real Macs.
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIos) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

export function detectNotificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

// ── Persistence (localStorage; sessionStorage guards the visit count) ─────

const VISITS_KEY = "bt.pwa.visits.v1";
const SESSION_COUNTED_KEY = "bt.pwa.sessionCounted.v1";
const DISMISS_KEY = "bt.pwa.bannerDismiss.v1";

/** Count at most one visit per browser session; returns the total. */
export function recordVisit(): number {
  try {
    const current = parseInt(localStorage.getItem(VISITS_KEY) ?? "0", 10) || 0;
    if (sessionStorage.getItem(SESSION_COUNTED_KEY)) return current;
    sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
    const next = current + 1;
    localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    return 0; // storage unavailable → treat as unengaged (banner stays hidden)
  }
}

export function readDismissal(): DismissalRecord | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DismissalRecord>;
    if (typeof parsed.at !== "number" || typeof parsed.count !== "number") {
      return null;
    }
    return { at: parsed.at, count: parsed.count };
  } catch {
    return null;
  }
}

export function recordDismissal(): void {
  try {
    const prev = readDismissal();
    const record: DismissalRecord = {
      at: Date.now(),
      count: (prev?.count ?? 0) + 1,
    };
    localStorage.setItem(DISMISS_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable — nothing to persist; the banner may reappear.
  }
}
