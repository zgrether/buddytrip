/**
 * Browser-side Web Push subscription (Push Phase 2). Turns the granted
 * Notification permission into a PushSubscription via the service worker and
 * extracts the keys the server needs. The tRPC POST (`notifications.subscribe`)
 * happens in the calling component; this module is the pure browser plumbing.
 *
 * Permission is requested by the caller on a USER GESTURE — never here on load.
 */

export interface BrowserSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
}

export function getVapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}

/** VAPID keys are URL-safe base64; the Push API wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  const bytes = new Uint8Array(key);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Subscribe this device via the SW registration and return the keys. Assumes
 * Notification permission is already `granted` (caller requested it on a
 * gesture). Reuses an existing subscription if present (idempotent client-side).
 * Returns null when push is unavailable (no SW, no VAPID key, or the subscribe
 * throws — e.g. Android 13+ OS-level block even though the site shows granted).
 */
export async function subscribeBrowser(): Promise<BrowserSubscription | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const vapid = getVapidPublicKey();
  if (!vapid) return null;

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: the DOM lib types applicationServerKey as BufferSource but the
        // Uint8Array<ArrayBufferLike> generic trips strict assignability.
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      }));

    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh ?? keyToBase64(sub.getKey("p256dh"));
    const auth = json.keys?.auth ?? keyToBase64(sub.getKey("auth"));
    if (!sub.endpoint || !p256dh || !auth) return null;

    return {
      endpoint: sub.endpoint,
      p256dh,
      auth,
      userAgent: navigator.userAgent.slice(0, 500),
    };
  } catch {
    // Two-layer permission (Android 13+): the site can show `granted` while
    // Chrome is blocked at the OS level, so subscribe() throws. Non-fatal —
    // the caller surfaces the denied/settings message.
    return null;
  }
}

/**
 * The endpoint of the LIVE subscription on this device, or null.
 *
 * Read-only and side-effect free — deliberately NOT `subscribeBrowser`, which
 * creates a subscription if none exists. The toggle has to be able to ask "is
 * this device subscribed?" without the act of asking making it true.
 */
/**
 * How long to wait for a service worker to become active before concluding
 * there isn't one.
 *
 * `navigator.serviceWorker.ready` NEVER SETTLES when no worker is registered —
 * it does not reject, it simply hangs forever. That is the documented behaviour,
 * and it is a trap for exactly this read: the caller has no error to catch and
 * no value to fall back to, so an un-raced await turns into a permanent
 * "Checking…" on the notifications row with nothing to explain it.
 *
 * Reachable in production, not just in dev. Registration is fire-and-forget with
 * a swallowed `.catch` (`ServiceWorkerRegistration.tsx`), and `'serviceWorker' in
 * navigator` is TRUE in the cases that then fail — a blocked registration in
 * private browsing, a 404 on `/sw.js`, a storage-partitioned context. The
 * `unsupported` state is checked BEFORE any of that and so never catches it.
 */
const SW_READY_TIMEOUT_MS = 3000;

/**
 * The endpoint this device is currently subscribed with, or null.
 *
 * Null covers "no worker, and we waited long enough to say so" as well as "a
 * worker, but no subscription". Both mean the same thing to every caller — there
 * is no live browser subscription — so they are deliberately not distinguished.
 * What matters is that this ALWAYS SETTLES: it gates the `probed` flag, and a
 * read that never returns leaves the UI asserting nothing forever, which is
 * strictly worse than reporting `off` on a device that is genuinely off.
 */
export async function currentPushEndpoint(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
    ]);
    if (!reg) return null;
    const sub = await reg.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Best-effort browser-side unsubscribe (returns the endpoint that was removed,
 *  so the caller can tell the server to drop it). */
export async function unsubscribeBrowser(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}
