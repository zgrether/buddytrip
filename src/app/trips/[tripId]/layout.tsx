import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { createSSRHelpers } from "@/server/trpc-ssr";
import { FaceBootSeed } from "@/components/competition/FaceBootSeed";
import { TripIdProvider } from "@/components/TripIdProvider";
import type { FaceBootstrap } from "@/components/competition/LiveFaceClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-trip route layout (Server Component) — the shell's server boundary.
 *
 * Prefetches on the server and dehydrates into the client cache, so the first
 * client render finds the data already there instead of firing a round trip.
 *
 * ── Why `faceBootstrap` lives HERE now (Phase 4) ─────────────────────────────
 * It used to be resolved by `leaderboard/page.tsx`, which stopped being a
 * surface when Phase 3 made the competition a TAB — so the alias hop lost the
 * seed and a cold Cup deep link paid a client fetch for it (measured: a 4-deep
 * waterfall, `faceBootstrap` fetched TWICE, 19 procedures across 6 batches).
 *
 * The layout is the right home because it is the one server boundary BOTH the
 * trip route and the leaderboard alias pass through, so one resolve now covers
 * every tab rather than one surface.
 *
 * ── Parallel, not serial ─────────────────────────────────────────────────────
 * The two prefetches are issued together and awaited with `Promise.all`, so the
 * layout's added wall-clock is the MAX of the two rather than their sum.
 * Awaiting them in sequence would make the cheap `getByTrip` wait behind the
 * heavier bootstrap for no reason.
 *
 * Failures are swallowed per-prefetch: if the user isn't authed or isn't a
 * member, the page surfaces the right error state, and throwing from a layout
 * would replace the whole page with an error boundary. `allSettled` rather than
 * `all` so one failing resolve can't discard the other's result.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId: param } = await params;

  let dehydratedState: DehydratedState | undefined = undefined;
  let boot: FaceBootstrap | null = null;
  let canonicalId: string | null = null;
  try {
    const helpers = await createSSRHelpers();

    /**
     * Resolve the param to the canonical UUID BEFORE prefetching.
     *
     * This used to prefetch with the RAW param, which is a slug whenever the
     * user arrived from a trip list (`TripCard` / `ContextRail` both navigate
     * to `slug ?? id`). A slug never matches `trip_members.trip_id`, so
     * `requireTripMember` threw FORBIDDEN on every slug-door entry — and
     * `allSettled` + the `fulfilled` check swallowed it silently. The symptom
     * was invisible server-side: `boot` just came back null, the seed became a
     * no-op, and the client paid a full round trip that ALSO failed (see
     * TripIdProvider for the whole chain).
     *
     * A UUID param skips the lookup, so the common path costs nothing extra;
     * the slug path trades one server query for the client-side `resolveSlug`
     * round trip each consumer used to pay separately.
     */
    canonicalId = UUID_RE.test(param)
      ? param
      : (await helpers.trips.resolveSlug.fetch({ slugOrId: param })).id;

    // Issued together, awaited once: the added wall-clock is the MAX of the two,
    // not their sum. `allSettled` so one failure can't discard the other's result.
    const [, bootResult] = await Promise.allSettled([
      helpers.competitions.getByTrip.prefetch({ tripId: canonicalId }),
      helpers.competitions.faceBootstrap.fetch({ tripId: canonicalId }),
    ]);
    if (bootResult.status === "fulfilled") boot = bootResult.value as FaceBootstrap;
    dehydratedState = helpers.dehydrate();
  } catch {
    // Auth, membership, or an unknown slug — fall through to the client, which
    // renders the right error state (and bounces a dead slug to /dashboard).
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      {/* The ONE resolution point for the URL param → canonical trip UUID.
          Everything trip-scoped below reads `useTripId()`; nothing re-derives
          it from `useParams()`. See TripIdProvider. */}
      <TripIdProvider initialTripId={canonicalId} initialParam={param}>
        {/* Explicit seed — the dehydrated state alone does not reach the client
            cache here; see FaceBootSeed for the evidence and why. Keyed by the
            CANONICAL id, which is what every client consumer now queries with. */}
        {canonicalId && <FaceBootSeed tripId={canonicalId} boot={boot} />}
        {children}
      </TripIdProvider>
    </HydrationBoundary>
  );
}
