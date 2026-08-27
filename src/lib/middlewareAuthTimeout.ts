/**
 * The middleware's escape hatch from a hung `getUser()`, plus the instrument
 * that tells us why it hung.
 *
 * ── The failure this exists for ────────────────────────────────────────────
 *
 * `src/middleware.ts` awaits `supabase.auth.getUser()` on every matched
 * request — including every `/api/trpc/*` call — with no timeout and no
 * fallback. Observed in production 2026-08-27: bursts of `504
 * MIDDLEWARE_INVOCATION_TIMEOUT`, six concurrent requests failing in the same
 * second, taking `pickem.savePicks` and `pickem.setPhase` down with them. The
 * client parses Vercel's error page as JSON and reports `Unexpected token 'A'`
 * — the first character of "A server error has occurred".
 *
 * Measured during the failure window, so this is not the usual suspects:
 * Supabase served 45 `/user` calls, all 200, in single-digit-to-247
 * milliseconds. JWKS 0.2–7.5ms. Database healthy — 23/60 connections, no lock
 * waits. The auth server answered everything asked of it and the edge function
 * still did not return within 25 seconds.
 *
 * **The trigger is still unidentified.** Ruled out by measurement: dependency
 * drift (the lockfile pins supabase-js 2.99.1 / ssr 0.9.0), the legacy-key
 * disablement (dated 2026-03-20, five months prior), request volume (~75 in 45
 * minutes), and any polling or added concurrency from the pick'em and
 * Quick-Play work. So this module is deliberately TWO things, and the second is
 * the more important one right now:
 *
 *   1. a guard, so a stall degrades instead of blocking
 *   2. an instrument, so the next occurrence produces data instead of a
 *      25-second hole
 *
 * ── The rule this must never break ─────────────────────────────────────────
 *
 * **A timeout must not sign anyone out.** Zach's call, and it is the right one:
 * on bad cell signal a timeout could be routine, and turning a flaky connection
 * into repeated forced re-logins is worse than the bug. So the timeout branch
 * decides NOTHING — no redirect, no 401 — and lets the request through.
 *
 * That is safe because **middleware is a UX redirect layer, not the security
 * boundary.** `authedProcedure` (`src/server/trpc.ts`) and RLS re-check every
 * request regardless of what middleware concluded, so passing one through
 * grants no access; it only skips a redirect. A signed-out person still gets
 * `UNAUTHORIZED` from tRPC and the existing `authExpiry` recovery (#689).
 *
 * ── The cost, stated rather than discovered later ──────────────────────────
 *
 * Middleware is the confirmed token-refresh path (`DATA_FRESHNESS_AUDIT.md`
 * §6.3): `getUser()` rotates cookies via `setAll` for someone whose access
 * token expired while they were only polling. A timeout skips that refresh, so
 * the client may hit a 401 on its next call and recover through `authExpiry`
 * instead. Strictly better than a 25-second dead page or a forced logout — but
 * it is a real behaviour change on the auth path and wants watching.
 */

/** How long `getUser()` gets before the request proceeds without it.
 *
 *  2.5s is chosen against measurement, not taste: Supabase's own logs put
 *  `/user` between 5ms and 247ms, so 2.5s is an order of magnitude beyond the
 *  worst honest response and will only fire on a genuine stall. Low enough that
 *  a person on a bad connection waits a moment rather than 25 seconds. */
export const AUTH_TIMEOUT_MS = 2500;

/** A successful-but-slow resolve still gets logged above this, so the next
 *  investigation has the LATENCY DISTRIBUTION and not just the total failures.
 *  Near-misses are the data that would have shortened this one. */
export const AUTH_SLOW_MS = 1000;

const TIMED_OUT = Symbol("auth-timeout");

export type TimedResult<T> =
  | { timedOut: false; value: T; elapsedMs: number }
  | { timedOut: true; elapsedMs: number };

/**
 * Race a promise against the clock.
 *
 * Extracted rather than inlined so the property that matters — a promise that
 * never settles yields `timedOut: true` rather than hanging — is testable with
 * a fake, which it cannot be inside an edge middleware function.
 *
 * The timer is always cleared. An un-cleared `setTimeout` keeps the isolate's
 * event loop alive after the response is sent, which on a per-request edge
 * function is a slow leak in exactly the code path added to fix a hang.
 */
export async function resolveWithTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  now: () => number = Date.now
): Promise<TimedResult<T>> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const raced = await Promise.race([
      work(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
    const elapsedMs = now() - startedAt;
    return raced === TIMED_OUT
      ? { timedOut: true, elapsedMs }
      : { timedOut: false, value: raced as T, elapsedMs };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface AuthProbe {
  /** Names of the request's cookies. VALUES ARE NEVER READ — see below. */
  cookieNames: string[];
  pathname: string;
  method: string;
  elapsedMs: number;
  outcome: "timeout" | "slow";
}

/**
 * The log line for a stalled or slow auth call.
 *
 * ── Nothing here can carry a secret ────────────────────────────────────────
 *
 * It takes cookie NAMES and never values, and emits counts and booleans. A
 * session token in a log is a session token in Vercel's log retention, readable
 * by anyone with project access — and the whole point of this line is that it
 * will be read later by someone debugging, possibly pasted into an issue. The
 * shape is chosen so that pasting it anywhere is harmless.
 *
 * ── What each field is for ─────────────────────────────────────────────────
 *
 * `hasSession` separates "a signed-in person stalled" from "an anonymous
 * request stalled" — which is the single most useful split, because a stall
 * with no session cookie cannot be a token refresh and would kill that
 * hypothesis outright.
 *
 * `sessionChunks` catches the large-cookie case: `@supabase/ssr` splits an
 * oversized session across `…auth-token.0`, `.1`, … and a session large enough
 * to chunk is a different performance profile from one that is not.
 */
export function authProbeLine(probe: AuthProbe): string {
  const session = probe.cookieNames.filter(
    (n) => n.startsWith("sb-") && n.includes("auth-token")
  );
  return JSON.stringify({
    tag: "auth-probe",
    outcome: probe.outcome,
    path: probe.pathname,
    method: probe.method,
    elapsedMs: probe.elapsedMs,
    hasSession: session.length > 0,
    sessionChunks: session.length,
    cookieCount: probe.cookieNames.length,
  });
}
