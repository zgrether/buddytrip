import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { resolveMiddlewareUser, type MiddlewareAuth } from "@/lib/middlewareUser";
import { AUTH_TIMEOUT_MS, resolveWithTimeout } from "@/lib/middlewareAuthTimeout";

/**
 * Who is calling an API route that is not tRPC — decided BY THE ROUTE.
 *
 * The middleware already asks, but it is a redirect layer: when its auth check
 * stalls or throws it passes the request through on purpose, so that bad
 * signal never signs anyone out. tRPC is safe behind that because
 * `authedProcedure` and RLS ask again. These routes spend paid API keys and
 * make outbound fetches, and nothing behind the middleware asked again.
 *
 * So each route asks here, and the answer FAILS CLOSED:
 *  - a signed-in caller        -> the route runs;
 *  - nobody signed in          -> 401;
 *  - could not find out (stall or error) -> 503, and the route does NOT run.
 *
 * The 503 is the opposite of the middleware's pass-through, deliberately. A
 * refused autocomplete costs one retry; an unchecked one spends the key for
 * whoever happened to ask.
 *
 * Same resolution as the middleware (`resolveMiddlewareUser`: local
 * `getClaims()`, then `getUser()` on an error) under the same ceiling, so a
 * route and the middleware cannot disagree about who a token belongs to.
 */
export type RouteCaller =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function resolveRouteCaller(auth: MiddlewareAuth): Promise<RouteCaller> {
  const resolved = await resolveWithTimeout(() => resolveMiddlewareUser(auth), AUTH_TIMEOUT_MS);
  if (resolved.timedOut) {
    console.warn(`[routeCaller] could not confirm the caller (${resolved.cause}); refusing`);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not confirm your session just now. Try again in a moment." },
        { status: 503 }
      ),
    };
  }
  if (!resolved.value) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in to use this." }, { status: 401 }),
    };
  }
  return { ok: true, userId: resolved.value.id };
}

/** The request's own session, read from its cookies. Building the client is
 *  inside the race too, so a throw there is "could not find out", not a 500. */
export async function routeCaller(): Promise<RouteCaller> {
  return resolveRouteCaller({
    getClaims: async () => (await createClient()).auth.getClaims() as ReturnType<MiddlewareAuth["getClaims"]>,
    getUser: async () => (await createClient()).auth.getUser() as ReturnType<MiddlewareAuth["getUser"]>,
  });
}
