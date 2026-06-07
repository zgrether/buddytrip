import { initTRPC, TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
export type TripRoleString = "Owner" | "Organizer" | "Member";

/** The authenticated user the server needs, populated from locally-verified
 *  JWT claims (claims.sub / claims.email). We don't need the full Supabase
 *  `User` on the server — only the id (plus email at a couple of call sites). */
export interface AuthUser {
  id: string;
  email: string | null;
}

export interface TRPCContext {
  supabase: SupabaseClient;
  user: AuthUser | null;
  membershipCache: Map<string, TripRoleString>;
}

/**
 * Creates context for the API route handler.
 * Re-uses the shared createClient() from supabase-server which provides both
 * getAll AND setAll cookie callbacks — required by @supabase/ssr for session
 * hydration so PostgREST receives the authenticated role instead of anon.
 *
 * Auth resolution favors `getClaims()` — it verifies the access token LOCALLY
 * (the project signs with ES256, and auth-js caches the JWKS process-wide), so
 * the common case avoids a per-request network round-trip to the Auth server
 * that `getUser()` would make. The DB still re-validates the same JWT under RLS
 * on every query, so this is purely a populate-ctx step, not the security
 * boundary. We fall back to `getUser()` when the local verify yields no user
 * (no session, or an expired access token) — that network path also refreshes
 * an expired token via the refresh cookie, preserving long sessions.
 */
export const createTRPCContext = async (): Promise<TRPCContext> => {
  const { createClient } = await import("@/lib/supabase-server");
  const supabase = await createClient();

  let user: AuthUser | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (claims && typeof claims.sub === "string") {
      user = {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
      };
    }
  } catch {
    // JWKS unavailable or token malformed — fall through to the network path.
  }
  if (!user) {
    const {
      data: { user: networkUser },
    } = await supabase.auth.getUser();
    user = networkUser ? { id: networkUser.id, email: networkUser.email ?? null } : null;
  }

  return { supabase, user, membershipCache: new Map() };
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
