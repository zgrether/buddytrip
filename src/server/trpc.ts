import { cookies } from "next/headers";
import { initTRPC, TRPCError } from "@trpc/server";
import {
  AUTH_TIMEOUT_MS,
  authProbeLine,
  resolveWithTimeout,
} from "@/lib/middlewareAuthTimeout";
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
    /**
     * ── RACED, because this is where a request DIES ────────────────────────
     *
     * The middleware got a 2.5s guard after the 2026-08-27 stall; this call
     * did not, and it is the more expensive one to leave unguarded. Middleware
     * timing out costs a skipped redirect. THIS timing out costs the whole
     * serverless invocation — observed 2026-08-29 as
     * `Vercel Runtime Timeout Error: Task timed out after 300 seconds` on
     * `pickem.get`, with the client spinning for five minutes.
     *
     * It is also the path a long-open device takes: `getClaims()` verifies
     * locally and only yields nothing once the access token has EXPIRED, which
     * is exactly the state every tab left open for an hour is in. That is why
     * the symptom was "it spins on all my devices" rather than one browser.
     *
     * Same ceiling as the middleware deliberately — one number, so a third
     * incident can be compared against the first two rather than against a
     * second arbitrary threshold.
     */
    const resolved = await resolveWithTimeout(
      () => supabase.auth.getUser(),
      AUTH_TIMEOUT_MS
    );

    if (resolved.timedOut) {
      const cookieNames = (await cookies()).getAll().map((c) => c.name);
      console.warn(
        authProbeLine({
          cookieNames,
          surface: "trpc",
          pathname: "/api/trpc",
          method: "POST",
          elapsedMs: resolved.elapsedMs,
          outcome: "timeout",
        })
      );

      /**
       * ── A timeout must not sign anyone out ─────────────────────────────
       *
       * Falling through with `user = null` would be the obvious move and it is
       * the wrong one: `authedProcedure` turns that into UNAUTHORIZED, which
       * the client reads as a dead session — a forced re-login caused by a
       * stall, on a person whose token is fine. That was ruled out in #1094
       * and it is ruled out here.
       *
       * So a signed-in caller gets a RETRYABLE error instead. TIMEOUT is a
       * transient failure the client can retry through; it grants nothing,
       * since RLS re-checks every query regardless of what this context
       * concluded.
       *
       * An ANONYMOUS caller — no session cookie — falls through with a null
       * user as before. There is nothing to sign out, refusing them would
       * break the public procedures they legitimately call, and their
       * `getUser()` cannot have been a token refresh.
       */
      const hasSession = cookieNames.some(
        (n) => n.startsWith("sb-") && n.includes("auth-token")
      );
      if (hasSession) {
        throw new TRPCError({
          code: "TIMEOUT",
          message:
            "Could not confirm the session in time. Nothing is lost — this retries on its own.",
        });
      }
    } else {
      const networkUser = resolved.value.data.user;
      user = networkUser ? { id: networkUser.id, email: networkUser.email ?? null } : null;
    }
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
