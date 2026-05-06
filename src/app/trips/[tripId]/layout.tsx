import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { createSSRHelpers } from "@/server/trpc-ssr";

/**
 * Per-trip route layout (Server Component).
 *
 * Prefetches the bundled `competitions.hydrate` query on the server
 * during the same render that produces the trip page HTML, then hands
 * the dehydrated TanStack Query cache off to the client via
 * `<HydrationBoundary>`. The trip page (a Client Component) and its
 * descendants pick up the cached data the moment React hydrates, so
 * the comp tab renders with real data on the very first paint —
 * skipping the loading skeleton entirely on cold loads.
 *
 * Invalidations after mutations still refetch the granular endpoints
 * (teams.list, events.list, etc.) as before; the SSR prefetch only
 * fires once per trip-page navigation.
 *
 * Failures here are intentionally swallowed: if the user doesn't have
 * access yet (e.g. invitation not accepted) the trip page itself
 * surfaces the error. Throwing from the layout would replace the
 * whole page with the error boundary instead.
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
  try {
    const helpers = await createSSRHelpers();
    await helpers.competitions.hydrate.prefetch({ tripId });
    dehydratedState = helpers.dehydrate();
  } catch {
    // Auth or membership errors during prefetch — fall through to the
    // client-side fetch which will surface the right UI state.
  }

  return (
    <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
  );
}
