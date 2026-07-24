import webpush from "web-push";

/**
 * VAPID configuration for Web Push (Phase 2). SERVER-ONLY — imports `web-push`
 * and reads the PRIVATE key, which is Production-scoped on Vercel (like
 * SUPABASE_SERVICE_ROLE_KEY; #634). Never import this from client code.
 *
 * Push degrades gracefully when unconfigured (local/CI/preview without keys):
 * `pushConfigured()` is false and callers no-op, so nothing 500s. `web-push` is
 * configured lazily on first use so an unset env doesn't throw at import time.
 */

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@bbmi.app";

let configured = false;

/** True when both VAPID keys are present — the only state in which a real push
 *  can be sent. Callers gate on this and no-op otherwise. */
export function pushConfigured(): boolean {
  return !!PUBLIC_KEY && !!PRIVATE_KEY;
}

/** Returns the configured `web-push`, or null when keys are missing. Configures
 *  it once, lazily, so an unset env never throws at module load. */
export function getWebPush(): typeof webpush | null {
  if (!pushConfigured()) return null;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY!, PRIVATE_KEY!);
    configured = true;
  }
  return webpush;
}
