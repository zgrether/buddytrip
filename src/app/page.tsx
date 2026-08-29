import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { MarketingPage } from "@/components/marketing/MarketingPage";
import {
  resolveWithTimeout,
  authProbeLine,
  AUTH_TIMEOUT_MS,
  AUTH_SLOW_MS,
} from "@/lib/middlewareAuthTimeout";
import { rootRouteDecision } from "@/lib/rootRouteDecision";

/**
 * Root route `/` — Server Component.
 *
 * Two completely separate experiences live here:
 *
 *  1. Unauthenticated visitors → the public marketing page.
 *  2. Authenticated users     → redirect to their last-visited trip
 *     (read from the `bt-last-trip-id` cookie, which the trip page
 *     writes alongside its localStorage entry on every visit) or
 *     /dashboard if no cookie is set.
 *
 * Running this on the server eliminates the cold-load waterfall the
 * old client component had — refresh used to send: blank shell → JS
 * bundle download (including all of MarketingPage even for authed
 * users) → auth context resolves → trips.list round-trip → client
 * router.replace → trip route bundle download. The user sat on the
 * full-screen loader through every step. Now the server sees the auth
 * cookie + the last-trip-id cookie and replies with a 307 to
 * /trips/[id] immediately. No loader, no marketing-page JS download
 * for authed users.
 *
 * The cookie isn't perfectly authoritative — a user opening BuddyTrip
 * on a new device (no cookie yet) lands on /dashboard, which already
 * runs the trip-list priority sort and renders the empty state if
 * they have no trips. That's a one-time fallback, not the common
 * path.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const lastTripId = cookieStore.get("bt-last-trip-id")?.value;

  /**
   * ── This route is the PWA's start_url, which makes it the launch path ─────
   *
   * `manifest.ts` sets `start_url: "/"`, so opening the installed app from a
   * home screen lands HERE — and the dark splash a phone shows while waiting
   * is `background_color: "#0a0e1a"`, this route's own background.
   *
   * That matters because a signed-in launch is a CHAIN, and every link makes
   * its own auth round trip: middleware on `/`, then this component, then
   * middleware again on `/trips/<id>`, then the tRPC context on each batch the
   * trip page fires. Un-timed, those hangs are SERIAL — which is how a
   * reported failure ran to minutes rather than the 25s a single middleware
   * timeout can produce. Guarding the middleware alone (#1095) could not have
   * fixed it, and the minutes are the evidence.
   *
   * ── On timeout, the cookie decides ───────────────────────────────────────
   *
   * `bt-last-trip-id` is written by the trip page on every visit, so its
   * presence means "this browser has been signed in and inside a trip". That
   * is a good enough answer when the auth server will not respond:
   *
   *   * cookie present → send them to their trip. If the session is actually
   *     dead, the trip route's own gate bounces them to /login — the ordinary
   *     path, not a special case.
   *   * no cookie     → the marketing page, which is what an unknown visitor
   *     gets anyway.
   *
   * Nobody is signed out by a timeout, which is the standing rule from #1094.
   * The worst case is a returning user taking one extra hop.
   */
  const resolved = await resolveWithTimeout(
    () => supabase.auth.getUser(),
    AUTH_TIMEOUT_MS
  );

  if (resolved.timedOut || resolved.elapsedMs > AUTH_SLOW_MS) {
    console.warn(
      authProbeLine({
        cookieNames: cookieStore.getAll().map((c) => c.name),
        surface: "home",
        pathname: "/",
        method: "GET",
        elapsedMs: resolved.elapsedMs,
        outcome: resolved.timedOut ? "timeout" : "slow",
      })
    );
  }

  // The four-way decision lives in `rootRouteDecision` so each arm — the
  // timeout one especially — is assertable. This component does the IO and the
  // navigating; it does not also hold the rules.
  const destination = rootRouteDecision({
    timedOut: resolved.timedOut,
    hasUser: resolved.timedOut ? false : !!resolved.value.data.user,
    lastTripId,
  });

  // `redirect()` throws to unwind, so these are terminal. `/dashboard` shares
  // the data path the old client redirector used (trips list + priority sort)
  // and falls back to the AuthenticatedEmptyState for a user with no trips.
  if (destination.kind === "trip") redirect(`/trips/${destination.tripId}`);
  if (destination.kind === "dashboard") redirect("/dashboard");
  return <MarketingPage />;
}
