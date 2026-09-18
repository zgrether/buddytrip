import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/router";
import { createTRPCContext } from "@/server/trpc";

/**
 * BACKSTOP, NOT THE PRIMARY BOUND (#1258).
 *
 * Vercel's default ceiling is 300 seconds — measured, not assumed: 19 requests
 * hit `Task timed out after 300 seconds` on this route on 2026-08-29. 60s ends
 * that, and is deliberately generous, because this value also bounds work that
 * runs AFTER the response:
 *
 *   - `games.finish` sends its push and runs the clinch check inside
 *     `afterResponse` (#1387). Typical cost ~1-2s; the worst ever observed was
 *     5.1s, on Day 4 of BBMI 2026, before the realtime coalescing (#1384) and
 *     the region pin (#933). A tight value would kill those pushes INVISIBLY:
 *     the user already has their response, so nothing surfaces.
 *   - The slowest legitimate REQUEST measured (2026-09-18, post-pin) is 5.7s —
 *     the game-open batch, 1 run in 40, whose own database reads took 2.6-3.4s
 *     each under contention.
 *
 * 60s is ~10x the slowest measured request and ~12x the worst deferred push.
 * The per-call abort (8s, admin client 20s) is the bound meant to fire; this one
 * exists so that when everything else fails the function dies in a minute rather
 * than five.
 */
export const maxDuration = 60;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
