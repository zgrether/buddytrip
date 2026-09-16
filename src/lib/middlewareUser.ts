/**
 * `resolveMiddlewareUser` — who is making this request, as the middleware needs to
 * know it: enough to decide redirect-or-pass, and to rotate an expired session's
 * cookies on the way through.
 *
 * ── Why `getClaims()`, not `getUser()` ──────────────────────────────────────
 * `getUser()` is a network round trip to Supabase Auth on EVERY request the
 * matcher covers — 7,849 of them on 2026-09-13, 9.6% of all Supabase requests,
 * p50 118 ms and p99 6.6 s, and the source of 83–94% of the `auth-probe` "slow"
 * warnings. `getClaims()` verifies the access token LOCALLY (WebCrypto against the
 * project JWKS, cached module-wide for 10 minutes per storage key), which is what
 * tRPC's context already does (`trpc.ts`).
 *
 * What the middleware actually depends on is pinned against the installed
 * libraries by `supabaseGetClaims.contract.test.ts`: an expired token is refreshed
 * and the rotated session written back through `setAll` (the middleware is the
 * token-refresh path); a valid token makes no `/user` call; a dead refresh token
 * still produces the cookie deletions the tRPC 401 forwards.
 *
 * ── What this gives up, stated plainly ──────────────────────────────────────
 * A session signed out or revoked elsewhere keeps passing the middleware until its
 * access token expires. That is acceptable because the middleware is a REDIRECT
 * layer, not the security boundary: `authedProcedure` and RLS decide what a request
 * may read or write, and RLS trusts the JWT's signature and expiry regardless of
 * which call the middleware made — `getUser()` here never protected any data.
 *
 * ── The fallback ───────────────────────────────────────────────────────────
 * `getUser()` runs only when `getClaims()` returned an ERROR (a JWKS fetch that
 * failed, a signature that did not verify). No session at all is not an error —
 * it returns `null` with no network call. `getClaims()` itself already falls back
 * to `getUser()` for symmetric (HS256) tokens or a runtime without WebCrypto.
 * A non-auth throw propagates, so `resolveWithTimeout` reports it as `rejected`
 * exactly as it did for `getUser()`.
 */

export type MiddlewareAuth = {
  getClaims: () => Promise<{ data: { claims: { sub?: unknown } } | null; error: unknown }>;
  getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
};

export async function resolveMiddlewareUser(auth: MiddlewareAuth): Promise<{ id: string } | null> {
  const { data, error } = await auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub === "string" && sub.length > 0) return { id: sub };
  if (!error) return null;

  const fallback = await auth.getUser();
  return fallback.data.user ? { id: fallback.data.user.id } : null;
}
