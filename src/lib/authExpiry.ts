import { createClient } from "@/lib/supabase";

/**
 * Involuntary session-expiry recovery.
 *
 * Called from the global QueryCache onError whenever a tRPC query comes back
 * UNAUTHORIZED (401). Before this existed, a poll that outlived its session just
 * kept firing forever against a dead session — the leaderboard silently froze on
 * stale scores while the app cheerfully polled (the mid-round-expiry bug the
 * Vercel CPU investigation surfaced). Now a 401 triggers exactly one of two
 * outcomes:
 *
 *   1. Self-heal — the browser Supabase client still holds a valid refresh
 *      token (the common "backgrounded tab, access token expired" case). One
 *      refreshSession() writes fresh cookies; the next poll tick succeeds and
 *      the surface recovers on its own, no user disruption.
 *   2. Truly expired — refresh fails (refresh token dead/revoked). We hard-nav
 *      to /login, which tears down every mounted poll/observer so the loop
 *      stops immediately, and forces re-auth. In-flight scores are safe: the
 *      localStorage outbox (CLAUDE.md #15) persists them and recovers after
 *      sign-in.
 *
 * A module-level in-flight guard collapses the burst of simultaneous 401s from
 * one batched poll into a single refresh/redirect.
 */

let handling = false;

/** Public routes never gate on auth, so a 401 there must not bounce (and never
 *  loop /login → /login). Mirrors middleware's isPublicRoute set. */
function isPublicPath(path: string): boolean {
  return (
    path === "/" ||
    path === "/login" ||
    path === "/privacy" ||
    path === "/terms" ||
    path.startsWith("/auth/") ||
    path.startsWith("/scoreboard/") ||
    path.startsWith("/invite")
  );
}

export async function handleAuthExpiry(): Promise<void> {
  if (typeof window === "undefined") return;
  if (handling) return;
  if (isPublicPath(window.location.pathname)) return;
  handling = true;

  try {
    const supabase = createClient();
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      // Self-healed: fresh cookies are written, the next poll tick recovers.
      // Release the guard so a later, unrelated expiry can be handled again.
      handling = false;
      return;
    }
  } catch {
    // Network error or no refresh token — fall through to the redirect.
  }

  // Truly expired. Keep the guard latched (we're leaving the page anyway) and
  // hard-nav so all polls unmount. Not router.push: a full load guarantees no
  // observer survives to keep 401-polling.
  window.location.assign("/login");
}

/** Detects the tRPC/react-query UNAUTHORIZED shape (401) on a query error. */
export function isUnauthorizedError(error: unknown): boolean {
  const data = (error as { data?: { code?: string; httpStatus?: number } } | null)
    ?.data;
  return data?.code === "UNAUTHORIZED" || data?.httpStatus === 401;
}
