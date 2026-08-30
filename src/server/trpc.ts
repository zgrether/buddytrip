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
  /**
   * ── RACED TOO, and leaving it unraced was the previous fix's blind spot ───
   *
   * `getClaims()` verifies the token LOCALLY, which is why it is preferred — but
   * "locally" is only true once the JWKS is in hand, and the first call in a
   * cold isolate fetches the signing keys over the network. Same host, same
   * stall. A `try/catch` handles a rejection; it does nothing about a promise
   * that never settles.
   *
   * That is exactly what the second incident looked like: 300-second
   * invocations on `games.configHash` and `pickem.get` with NOT ONE
   * `surface: "trpc"` line in the logs. The guarded call below was never
   * reached, because the unguarded one here never returned — the absence of
   * the timeout log is what located the hang.
   *
   * The lesson is narrower than "add a timeout": ONE FUNCTION HELD TWO CALLS
   * to the stalling dependency and only one was guarded, so the fix held for
   * the path being looked at and not for the one that was not. The sweep that
   * found the invite page needed running INSIDE this function too.
   *
   * `.catch(() => null)` keeps a rejection meaning what it meant before — JWKS
   * unavailable or token malformed, fall through to the network path — rather
   * than letting the race reject and take the request with it.
   */
  const claimed = await resolveWithTimeout(
    () => supabase.auth.getClaims().catch(() => null),
    AUTH_TIMEOUT_MS
  );
  if (claimed.timedOut) {
    console.warn(
      authProbeLine({
        cookieNames: (await cookies()).getAll().map((c) => c.name),
        surface: "trpc",
        pathname: "/api/trpc",
        method: "POST",
        elapsedMs: claimed.elapsedMs,
        outcome: "timeout",
      })
    );
  } else {
    const claims = claimed.value?.data?.claims;
    if (claims && typeof claims.sub === "string") {
      user = {
        id: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
      };
    }
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

/**
 * What a person is told when the SCHEMA refused the request.
 *
 * Not a description of the failure: a validation error means the client sent
 * something the input schema does not admit, which is a contract bug rather
 * than a condition the reader can act on. Where such a rejection IS something
 * they should be able to fix, the answer is a real guard with a real sentence —
 * not a nicer rendering of the issue list.
 */
export const VALIDATION_MESSAGE = "That change couldn't be saved. Reload and try again.";

/**
 * Did the input SCHEMA refuse this, as opposed to the procedure?
 *
 * Both facts are measured rather than assumed — tRPC gives a validation failure
 * `code: "BAD_REQUEST"` and attaches the `ZodError` as `cause`, and
 * `trpcValidationError.test.ts` pins that against a real procedure rather than
 * against this description of one. If tRPC ever changed either, the test fails
 * here rather than the payload quietly reappearing on a screen.
 *
 * Exported for that test. `errorFormatter` itself is NOT reachable from a
 * `createCaller` — it runs on the HTTP response boundary only, which is
 * measured in the same file — so the predicate is the part that can be checked,
 * and the client-side backstop in `mutationErrorMessage` covers what the
 * formatter cannot see.
 */
export function isSchemaValidationError(error: {
  code: string;
  cause?: unknown;
}): boolean {
  const cause = error.cause as { name?: unknown } | null | undefined;
  return error.code === "BAD_REQUEST" && cause?.name === "ZodError";
}

/**
 * ── THE ONE PLACE A VALIDATION PAYLOAD IS TURNED INTO A SENTENCE ────────────
 *
 * tRPC builds a `TRPCError` whose `message` is `JSON.stringify(zodError.issues)`,
 * so without this the ISSUE ARRAY is the message every surface receives. Saving
 * a pick'em sheet with nothing picked put this on screen, above the app's own
 * "Your sheet is still here":
 *
 *     [ { "origin": "array", "code": "too_small", "minimum": 1,
 *         "inclusive": true, "path": [ "picks" ],
 *         "message": "Too small: expected array to have >=1 items" } ]
 *
 * ── Why HERE and not at the twenty places that render it ───────────────────
 *
 * That was one call site noticing. Every mutation in the app carries a zod
 * input schema, and `20 surfaces set an inline error from `e.message` directly,
 * so the same payload renders on all of them — and on the next surface somebody
 * writes. Patching the readers is a sweep that has to be repeated; the message
 * only becomes a payload in one place, which is where it stops being one.
 *
 * Keyed on `error.cause` being a `ZodError` rather than on the message's shape,
 * because here the cause is still attached. (`mutationErrorMessage` keeps a
 * JSON-shape check as well: it sees errors that never came through tRPC, and by
 * then the cause is gone.)
 *
 * The message is REPLACED rather than added alongside — a `data.zodError` field
 * would put the payload back on the wire for the next component to render.
 * Nothing in the app renders per-field validation, so there is nothing to serve
 * by shipping it.
 */
const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    if (!isSchemaValidationError(error)) return shape;
    return { ...shape, message: VALIDATION_MESSAGE };
  },
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
