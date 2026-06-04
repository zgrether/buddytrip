import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { MarketingPage } from "@/components/marketing/MarketingPage";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <MarketingPage />;
  }

  const cookieStore = await cookies();
  const lastTripId = cookieStore.get("bt-last-trip-id")?.value;

  if (lastTripId) {
    redirect(`/trips/${lastTripId}`);
  }

  // Authed but we don't know which trip to send them to. /dashboard
  // shares the same data path the old client redirector used (trips
  // list + priority sort) and falls back to the AuthenticatedEmptyState
  // when the user has no trips at all.
  redirect("/dashboard");
}
