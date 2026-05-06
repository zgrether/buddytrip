import { initTRPC, TRPCError } from "@trpc/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import superjson from "superjson";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Request-scoped cache of trip memberships keyed by tripId.
 *
 * Populated by `requireTripMember` / `requireTripRole`. With
 * httpBatchLink, all procedures in a batched request share one ctx,
 * so a comp-tab load that fires 6 procedures against the same trip
 * collapses 6 `SELECT FROM trip_members` calls into 1.
 *
 * Stays per-request — never reused across HTTP requests, never used as
 * a security shortcut beyond the lifetime of a single batch.
 */
export type TripRoleString = "Owner" | "Planner" | "Member";

export interface TRPCContext {
  supabase: SupabaseClient;
  user: User | null;
  membershipCache: Map<string, TripRoleString>;
  /** Request-scoped cache of `competitionId → tripId`. Lets the
   *  duplicated `assertCompetitionInTrip` guard collapse to a single
   *  SELECT per competition per request batch. */
  competitionTripCache: Map<string, string>;
}

/**
 * Creates context for the API route handler.
 * Re-uses the shared createClient() from supabase-server which provides both
 * getAll AND setAll cookie callbacks — required by @supabase/ssr for session
 * hydration so that getSession() returns the JWT and PostgREST receives the
 * authenticated role instead of falling back to anon.
 */
export const createTRPCContext = async (): Promise<TRPCContext> => {
  const { createClient } = await import("@/lib/supabase-server");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    supabase,
    user,
    membershipCache: new Map(),
    competitionTripCache: new Map(),
  };
};

// ---------------------------------------------------------------------------
// tRPC init
// ---------------------------------------------------------------------------

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const middleware = t.middleware;
export const createCallerFactory = t.createCallerFactory;

// ---------------------------------------------------------------------------
// Base procedures
// ---------------------------------------------------------------------------

/** Unprotected — available to anyone. */
export const publicProcedure = t.procedure;

/** Requires an authenticated session. Narrows ctx.user to non-null. */
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Backwards compat alias
export const protectedProcedure = authedProcedure;
