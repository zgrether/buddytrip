import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { createSSRHelpers } from "@/server/trpc-ssr";
import { FaceBootSeed } from "@/components/competition/FaceBootSeed";
import type { FaceBootstrap } from "@/components/competition/LiveFaceClient";

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
  const { tripId } = await params;

  let dehydratedState: DehydratedState | undefined = undefined;
  let boot: FaceBootstrap | null = null;
  try {
    const helpers = await createSSRHelpers();
    // Issued together, awaited once: the added wall-clock is the MAX of the two,
    // not their sum. `allSettled` so one failure can't discard the other's result.
    const [, bootResult] = await Promise.allSettled([
      helpers.competitions.getByTrip.prefetch({ tripId }),
      helpers.competitions.faceBootstrap.fetch({ tripId }),
    ]);
    if (bootResult.status === "fulfilled") boot = bootResult.value as FaceBootstrap;
    dehydratedState = helpers.dehydrate();
  } catch {
    // Auth or membership errors — fall through to client-side fetch.
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      {/* Explicit seed — the dehydrated state alone does not reach the client
          cache here; see FaceBootSeed for the evidence and why. */}
      <FaceBootSeed tripId={tripId} boot={boot} />
      {children}
    </HydrationBoundary>
  );
}
