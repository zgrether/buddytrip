import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { createSSRHelpers } from "@/server/trpc-ssr";

/**
 * Per-trip route layout (Server Component).
 *
 * Prefetches `competitions.getByTrip` on the server so the competition
 * object is in the TanStack Query cache on first render. page.tsx calls
 * the same query client-side, so on navigations after the initial load
 * the data is already warm — no network round trip needed.
 *
 * Failures are swallowed: if the user isn't authed yet the trip page
 * surfaces the right error state; throwing from the layout would replace
 * the whole page with an error boundary.
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
    await helpers.competitions.getByTrip.prefetch({ tripId });
    dehydratedState = helpers.dehydrate();
  } catch {
    // Auth or membership errors — fall through to client-side fetch.
  }

  return (
    <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
  );
}
