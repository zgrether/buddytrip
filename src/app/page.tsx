"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthLoaded, useAuthUser } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc-client";
import { getEffectiveStatus } from "@/lib/tripStatus";
import { MarketingPage } from "@/components/marketing/MarketingPage";

/**
 * Root route `/`.
 *
 * Two completely separate experiences live here:
 *
 *  1. Unauthenticated visitors → full marketing page (`<MarketingPage />`)
 *  2. Authenticated users     → redirect to their most relevant trip via:
 *       a. last visited (localStorage `bt-last-trip-id`, if still a member)
 *       b. NOW (within 3 days of start, or mid-trip)
 *       c. UPCOMING > IDEA
 *       d. /dashboard if they have no trips (the dashboard renders the
 *          shared AuthenticatedEmptyState as its body)
 *
 * To avoid flashing the marketing page to a logged-in user, we render a
 * minimal full-screen loader while auth + the trips list are still
 * resolving. The marketing page never appears for authed users.
 */
export default function HomePage() {
  const authLoaded = useAuthLoaded();
  const user = useAuthUser();
  const router = useRouter();

  // Only fetch the trips list when we know the user is authenticated.
  const tripsQuery = trpc.trips.list.useQuery(undefined, {
    enabled: authLoaded && !!user,
  });

  // Track whether we've already kicked off a router.push so we don't loop
  // on re-renders while the navigation is in flight. Ref (not state) so
  // toggling it doesn't trigger another render.
  const redirectedRef = useRef(false);

  // Pick the priority trip from a loaded trips list.
  const targetTripId = useMemo(() => {
    if (!tripsQuery.data || tripsQuery.data.length === 0) return null;
    const trips = tripsQuery.data;

    // 1. localStorage last-visited (validated against current memberships)
    if (typeof window !== "undefined") {
      const lastId = window.localStorage.getItem("bt-last-trip-id");
      if (lastId && trips.some((t) => t.id === lastId)) return lastId;
    }

    // 2-4. Status priority via getEffectiveStatus
    const priority: Record<string, number> = {
      now: 0,
      upcoming: 1,
      idea: 2,
      past: 3,
    };
    const sorted = [...trips].sort((a, b) => {
      const pa = priority[getEffectiveStatus(a)] ?? 99;
      const pb = priority[getEffectiveStatus(b)] ?? 99;
      return pa - pb;
    });
    return sorted[0]?.id ?? null;
  }, [tripsQuery.data]);

  useEffect(() => {
    if (!authLoaded || !user) return;
    if (tripsQuery.isLoading) return;
    if (redirectedRef.current) return;

    if (targetTripId) {
      redirectedRef.current = true;
      router.replace(`/trips/${targetTripId}`);
      return;
    }

    // Authed but no trips → dashboard, which renders the shared
    // AuthenticatedEmptyState as its body. Single source of truth for
    // the no-trips experience.
    if (tripsQuery.data && tripsQuery.data.length === 0) {
      redirectedRef.current = true;
      router.replace("/dashboard");
    }
  }, [authLoaded, user, tripsQuery.isLoading, tripsQuery.data, targetTripId, router]);

  // ── Render branches ─────────────────────────────────────────────────────

  // While auth is resolving — or we know we're about to redirect — keep
  // the marketing page hidden behind a dark loader.
  if (!authLoaded) return <FullScreenLoader />;

  if (user) {
    // Authed: either still fetching trips or about to redirect (to a
    // trip if they have one, otherwise to /dashboard). Either way, the
    // loader covers the gap so the marketing page never flashes.
    return <FullScreenLoader />;
  }

  // Unauthenticated visitor → marketing page.
  return <MarketingPage />;
}

/**
 * Dark full-screen loader with the BuddyTrip mark centered. Shown while
 * auth resolves and while the trips list loads for an authed user — keeps
 * the marketing page from flashing.
 */
function FullScreenLoader() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: "#f1f5f9",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={{ color: "#2dd4bf", flexShrink: 0 }}
        >
          <path
            d="M 28 8 L 38 8 L 76 26 L 38 44 L 38 75 L 33 92 L 28 75 Z"
            fill="currentColor"
          />
        </svg>
        BuddyTrip
      </div>
    </div>
  );
}
