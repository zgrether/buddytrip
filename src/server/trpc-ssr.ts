import "server-only";
import { createServerSideHelpers } from "@trpc/react-query/server";
import superjson from "superjson";
import { appRouter } from "./router";
import { createTRPCContext } from "./trpc";

/**
 * Build server-side TanStack Query helpers for a single request.
 *
 * Use this from a Server Component (e.g. a route layout) to prefetch
 * data on the server, then dehydrate the in-memory query cache into
 * the response. Pair with `<HydrationBoundary state={helpers.dehydrate()}>`
 * inside the client tree so the singleton QueryClient picks it up
 * without a second network call.
 *
 * Each call creates a fresh ctx + queryClient — never reuse a single
 * helpers instance across requests, since ctx carries the request's
 * authenticated Supabase client and per-request caches.
 */
export async function createSSRHelpers() {
  const ctx = await createTRPCContext();
  return createServerSideHelpers({
    router: appRouter,
    ctx,
    transformer: superjson,
  });
}
