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
 * ── Two failure modes, one answer (#691) ───────────────────────────────────
 *
 * The auth server can fail to answer in two ways, and only one of them was
 * guarded here originally:
 *
 *   * it **stalls** — the call never comes back. Guarded since #1094/#1140.
 *   * it is **unreachable** — DNS, a reset connection, a TLS error. `auth-js`
 *     rethrows a non-`AuthError` rather than resolving it to `{ user: null }`,
 *     so this propagated through `resolveWithTimeout` and out of a middleware
 *     that has no `try/catch`, over a matcher covering essentially every route:
 *     a 500 on every page and every tRPC call at once.
 *
 * Both mean "we do not know who this is". Both now take the same branch, and
 * `AuthStallCause` keeps them apart in the log. See `resolveWithTimeout` for
 * the argument, including the one this reverses.
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

/**
 * WHY there was no usable answer.
 *
 * Both mean the same thing to every caller — "the auth server did not tell us
 * who this is, so decide without it" — and they are kept apart anyway, because
 * the whole second purpose of this module is that the NEXT incident is
 * comparable to the last three. A stall and a transport failure are different
 * faults with different fixes, and folding them into one word would be the
 * "empty is not unknown" mistake in a log line.
 */
export type AuthStallCause = "timeout" | "rejected";

export type TimedResult<T> =
  | { timedOut: false; value: T; elapsedMs: number }
  | { timedOut: true; cause: AuthStallCause; error?: unknown; elapsedMs: number };

/**
 * Race a promise against the clock, and CATCH IT IF IT THROWS.
 *
 * Extracted rather than inlined so the property that matters — a promise that
 * never settles yields `timedOut: true` rather than hanging — is testable with
 * a fake, which it cannot be inside an edge middleware function.
 *
 * The timer is always cleared. An un-cleared `setTimeout` keeps the isolate's
 * event loop alive after the response is sent, which on a per-request edge
 * function is a slow leak in exactly the code path added to fix a hang.
 *
 * ── The rejection arm, and the decision it reverses (#691) ─────────────────
 *
 * This used to be `try/finally`, so a REJECTED `work()` propagated out of the
 * race and out of every caller. A test asserted that deliberately, arguing
 * that swallowing a rejection "would make a broken session look like a slow
 * network and silently pass the request through — the opposite of what the
 * guard is for". That reasoning deserves a reply rather than a deletion, and
 * it rests on a premise that is not true:
 *
 *   1. **A broken session does not reject.** `auth-js` resolves an AuthError
 *      into `{ data: { user: null }, error }` — the ordinary signed-out path.
 *      A rejection is specifically the NON-AuthError case: DNS, a reset
 *      connection, a TLS failure. It says nothing about the session.
 *   2. **Nothing is silently passed through.** Middleware is a redirect layer,
 *      not the security boundary (see the header) — `authedProcedure` and RLS
 *      re-check the request regardless. The tRPC context does not pass through
 *      at all: a caller holding a session cookie gets a retryable TIMEOUT.
 *   3. **The distinction it wanted is kept, in the place that wanted it.**
 *      `cause` carries it into the probe line, so a transport failure never
 *      reads as a slow network in the logs. The old design preserved the
 *      distinction by crashing the request, which is a high price for a field.
 *
 * What propagating actually cost: `src/middleware.ts` has no `try/catch` and
 * its matcher covers essentially every route, so one unreachable-auth-server
 * moment was a 500 on every page and every tRPC call at once — for everyone,
 * with no login page and no degraded mode. That is strictly worse than the
 * degradation this guard already chose for the identical "no answer" condition.
 *
 * `timedOut` keeps its name for the union's discriminant rather than being
 * renamed to something like `answered`: every one of the four call sites
 * already branches on it to mean "we got no usable answer — degrade", the
 * rename would touch 41 sites across the auth path, and the field's real
 * meaning is now stated here and carried precisely by `cause`.
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
      ? { timedOut: true, cause: "timeout", elapsedMs }
      : { timedOut: false, value: raced as T, elapsedMs };
  } catch (error) {
    // `work()` threw or rejected. Same answer as a stall — we do not know who
    // this is — so the caller takes the same branch, and `cause` records that
    // it was not the clock.
    return { timedOut: true, cause: "rejected", error, elapsedMs: now() - startedAt };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * WHERE the stall happened.
 *
 * Every unguarded `getUser()` is its own hang with its own blast radius, and
 * after two incidents with no identified trigger the question that matters on
 * a third is whether it is the SAME SHAPE — same duration, same endpoint, same
 * token state, same place in the request. That is only answerable if each
 * timeout is recorded as its own event rather than folded into a generic
 * error, and if the events are directly comparable.
 *
 * So one line shape, one tag, and a field naming the caller.
 */
export type AuthSurface = "middleware" | "home" | "invite" | "trpc";

export interface AuthProbe {
  /** Names of the request's cookies. VALUES ARE NEVER READ — see below. */
  cookieNames: string[];
  surface: AuthSurface;
  pathname: string;
  method: string;
  elapsedMs: number;
  outcome: AuthStallCause | "slow";
  /**
   * For `rejected` only: the error's CONSTRUCTOR NAME (`TypeError`,
   * `AuthRetryableFetchError`, …) — never its message.
   *
   * It is the one field that separates "the fetch never left" from "something
   * else threw", which is the first question a fourth incident asks. A message
   * can carry a URL or a token and this line is written to be safe to paste
   * anywhere (see below); a constructor name is a bounded, non-secret string.
   */
  errorKind?: string;
}

/** The error's constructor name, or undefined for a non-Error throw. Kept
 *  beside `authProbeLine` so the "names, never values" rule has one home. */
export function errorKindOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.constructor?.name ?? "Error";
  return typeof error === "object" && error !== null ? undefined : typeof error;
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
    surface: probe.surface,
    path: probe.pathname,
    method: probe.method,
    elapsedMs: probe.elapsedMs,
    hasSession: session.length > 0,
    sessionChunks: session.length,
    cookieCount: probe.cookieNames.length,
    // Omitted entirely rather than emitted as null, so a `timeout` line is
    // byte-identical to the ones the first three incidents produced and stays
    // directly comparable to them.
    ...(probe.errorKind ? { errorKind: probe.errorKind } : {}),
  });
}
