/**
 * Forget the "last trip" pointer — the `bt-last-trip-id` localStorage key and
 * the cookie of the same name that the root route and the dashboard read on
 * the server (`app/page.tsx`, `app/dashboard/page.tsx`).
 *
 * Cleared whenever the trip it names stops being one the viewer can open: the
 * trip page's stale-pointer recovery, leaving a trip, and a removed person's
 * exit (PR 8d-3). Left in place, the root route would 307 straight back to a
 * trip that now refuses them.
 */
export function clearLastTripPointer(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("bt-last-trip-id");
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the cookie
    // below is the one the server reads, so clearing it is what matters.
  }
  document.cookie = "bt-last-trip-id=; Max-Age=0; Path=/; SameSite=Lax";
}
