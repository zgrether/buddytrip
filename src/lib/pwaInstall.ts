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

/** Engagement gate = IN-SESSION: the banner shows once the user has actually
 *  used the app THIS session (a navigation, or ~30s dwell — see ENGAGE_DELAY_MS
 *  + markEngaged). Chosen over return-visit counting so a first-time invited
 *  member (peak motivation) isn't asked to come back N times — while still not
 *  ambushing someone who hasn't seen the app yet. */
export const ENGAGE_DELAY_MS = 30_000;
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
 *
 * `engaged` gates the banner on in-session engagement. This is ALSO the exact
 * predicate the capture script uses to decide whether to `preventDefault()` —
 * the two MUST agree, or we'd suppress Chrome's native prompt in a state where
 * our own banner isn't showing (the dead-zone regression).
 */
export function resolveBannerState(input: {
  platform: PwaPlatform;
  standalone: boolean;
  engaged: boolean;
  dismissal: DismissalRecord | null;
  notificationPermission: NotificationPermissionState;
  now: number;
}): BannerState {
  const { platform, standalone, engaged, dismissal, notificationPermission, now } = input;

  // Desktop / unknown platforms never see the banner.
  if (platform === "other") return null;
  // Engagement gate — never before the user has actually used the app.
  if (!engaged) return null;
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

/** window global + notification event name + storage keys — MUST match the
 *  literals baked into INSTALL_CAPTURE_SCRIPT (it runs before this module and
 *  can't import them). Interpolated into the script string below so there's a
 *  single source of truth. */
const BIP_GLOBAL = "__btInstallPrompt";
const PWA_EVENT = "bt:pwa"; // fired on prompt capture/clear AND engagement change
const ENGAGED_KEY = "bt.pwa.engaged.v1"; // sessionStorage — in-session engagement
const DISMISS_KEY_LITERAL = "bt.pwa.bannerDismiss.v1"; // == DISMISS_KEY below

interface BipWindow {
  [BIP_GLOBAL]?: BeforeInstallPromptEvent | null;
}

/**
 * Inline capture script, injected `beforeInteractive` from the root layout so
 * it runs before hydration and can't miss the event.
 *
 * **Conditional `preventDefault()`** (the key contract): claiming the event
 * suppresses Chrome's OWN native install prompt. We only claim it when our
 * banner would show the install affordance *right now* — the SAME predicate as
 * `resolveBannerState`'s gate: engaged, not dismiss-suppressed, not installed.
 * Otherwise we let Chrome's native prompt through, so there's never a window
 * with no install affordance (the dead-zone regression: suppressing Chrome
 * while our banner is still gated out). We only STORE the event when we claimed
 * it — an un-claimed event is Chrome's to consume, and keeping it would leave a
 * dead one-tap button.
 */
export const INSTALL_CAPTURE_SCRIPT = `
(function(){
  var G='${BIP_GLOBAL}';
  window[G]=null;
  function notify(){ window.dispatchEvent(new Event('${PWA_EVENT}')); }
  function suppressed(){
    try {
      var raw=localStorage.getItem('${DISMISS_KEY_LITERAL}'); if(!raw) return false;
      var d=JSON.parse(raw);
      if(d && d.count>=${MAX_DISMISSALS}) return true;
      if(d && (Date.now()-d.at)<${DISMISS_DECAY_MS}) return true;
      return false;
    } catch(e){ return false; }
  }
  function engaged(){ try { return sessionStorage.getItem('${ENGAGED_KEY}')==='1'; } catch(e){ return false; } }
  function standalone(){
    try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone===true; } catch(e){ return false; }
  }
  window.addEventListener('beforeinstallprompt', function(e){
    // Only claim (and suppress Chrome) when our banner will show it now.
    if(!standalone() && !suppressed() && engaged()){
      e.preventDefault();
      window[G]=e;
      notify();
    }
    // else: let Chrome's native prompt through; don't store (no dead button).
  });
  window.addEventListener('appinstalled', function(){
    window[G]=null;
    notify();
  });
})();
`;

/** The earliest-captured install prompt, or null if none is available (never
 *  fired, not claimed because we were gated out, already consumed, or Chrome
 *  is suppressing it post-dismiss). */
export function getCapturedInstallPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as BipWindow)[BIP_GLOBAL] ?? null;
}

/** Subscribe to PWA state changes — prompt capture/clear AND engagement. */
export function subscribePwaState(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PWA_EVENT, cb);
  return () => window.removeEventListener(PWA_EVENT, cb);
}

/** Clear the captured prompt after `prompt()` resolves — the event is
 *  single-use (dismissed OR accepted), so a stale reference would leave a dead
 *  Install button. Clearing makes the banner fall back to the instructional
 *  copy. Notifies subscribers. */
export function clearCapturedInstallPrompt(): void {
  if (typeof window === "undefined") return;
  (window as unknown as BipWindow)[BIP_GLOBAL] = null;
  window.dispatchEvent(new Event(PWA_EVENT));
}

/** Whether the user has engaged with the app this session (a navigation or
 *  ~30s dwell). Read synchronously by the capture script too (same key). */
export function isEngaged(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(ENGAGED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark the session engaged (idempotent) and notify subscribers so a mounted
 *  banner re-resolves. A no-op after the first call per session. */
export function markEngaged(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(ENGAGED_KEY) === "1") return;
    sessionStorage.setItem(ENGAGED_KEY, "1");
  } catch {
    return; // no storage → stays un-engaged (banner never shows; acceptable)
  }
  window.dispatchEvent(new Event(PWA_EVENT));
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

// ── Persistence (localStorage) ────────────────────────────────────────────

// Kept in sync with DISMISS_KEY_LITERAL (baked into the capture script above).
const DISMISS_KEY = "bt.pwa.bannerDismiss.v1";

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
