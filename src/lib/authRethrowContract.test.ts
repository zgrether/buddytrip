import { describe, it, expect } from "vitest";
import { createServerClient } from "@supabase/ssr";

/**
 * WHAT `auth.getUser()` DOES WHEN IT FAILS — measured against the pinned
 * library, not read off its source.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * #691 was filed on a quoted fragment of `@supabase/auth-js`'s `_getUser`:
 *
 *     catch (error) {
 *       if (isAuthError(error)) { ... return { data: { user: null }, error }; }
 *       throw error;   // <-- "network failure lands here"
 *     }
 *
 * The fragment is real and still present in 2.99.1. The comment on it is
 * WRONG, and the difference decides how severe the issue is:
 *
 * **A network failure never reaches that `throw`.** `_handleRequest` catches a
 * failed fetch and rethrows it as `AuthRetryableFetchError`, which extends
 * `CustomAuthError` → `AuthError` and therefore carries `__isAuthError`. So
 * `isAuthError()` is TRUE for it and `getUser()` RESOLVES to
 * `{ user: null, error }` — the ordinary signed-out path.
 *
 * That was asserted from reading the source and then MEASURED, because reading
 * is what produced the wrong answer the first time. The two cases below are the
 * measurement.
 *
 * ── What this pins, and why it is worth a file ─────────────────────────────
 *
 * CLAUDE.md #23: a cross-library contract that can fail silently gets a runtime
 * test, because a type annotation is not one. This is that shape twice over —
 * the declared type says nothing about which failures resolve and which throw,
 * and the answer moved a severity assessment by a wide margin.
 *
 * If a future auth-js stops wrapping fetch failures, case 1 goes red HERE, at
 * the contract, rather than in production as a 500 on every route. The guard in
 * `middlewareAuthTimeout.ts` covers us either way — that is the point of it —
 * but this file is what would tell us the ground had moved.
 */

const ANON = "anon-key-not-used-because-fetch-never-succeeds";

function clientWith(
  fetchImpl: typeof fetch,
  getAll: () => { name: string; value: string }[] = () => [
    {
      name: "sb-example-auth-token",
      value: JSON.stringify({
        access_token: "a.b.c",
        refresh_token: "r",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    },
  ]
) {
  return createServerClient("https://example.supabase.co", ANON, {
    global: { fetch: fetchImpl },
    cookies: { getAll, setAll() {} },
  });
}

describe("auth-js getUser(): which failures resolve and which throw", () => {
  it("a NETWORK failure RESOLVES to { user: null } — it does not throw", async () => {
    // The case #691 assumed threw. It does not: the fetch rejection is wrapped
    // as AuthRetryableFetchError, which IS an AuthError.
    const supabase = clientWith((() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch);

    const result = await supabase.auth.getUser();

    expect(result.data.user).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error?.name).toBe("AuthRetryableFetchError");
    // The property that decides the branch, asserted directly rather than via
    // the name — the name is cosmetic, `__isAuthError` is what `isAuthError()`
    // actually reads.
    expect(result.error && "__isAuthError" in result.error).toBe(true);
  });

  it("even a NON-Error rejection from fetch is wrapped, not rethrown", async () => {
    // The obvious "surely a bare throw escapes" hypothesis. It does not —
    // `_handleRequest`'s catch is unconditional.
    const supabase = clientWith((() =>
      Promise.reject("a bare string")) as unknown as typeof fetch);

    const result = await supabase.auth.getUser();
    expect(result.data.user).toBeNull();
    expect(result.error?.name).toBe("AuthRetryableFetchError");
  });

  it("a throwing COOKIE STORE does escape — the real rethrow path", async () => {
    /**
     * Having ruled the network out, this is what is left, and it is OUR code
     * rather than the library's: `src/lib/supabase-server.ts` wraps `setAll` in
     * a try/catch and leaves `getAll` bare, so anything `cookies()` throws
     * propagates out of `getUser()` as a plain `Error`.
     *
     * Not known to be reachable in production — Next 15 awaits `cookies()`
     * before the client is built, so the store is already resolved by the time
     * `getAll` runs. It is recorded because it is the ONE demonstrated way to
     * reach the rethrow, and because it is the case that proves the guard is
     * doing something rather than guarding an empty set.
     */
    /**
     * ARMED after construction, deliberately. `createServerClient` kicks off
     * `_emitInitialSession` in the background, which reads cookies before any
     * test code runs — a getter that throws from the start rejects THERE, as an
     * unhandled error outside the assertion, which reports as a suite error
     * rather than as this test's finding. Arming makes the throw land on the
     * call under test and nowhere else.
     */
    let armed = false;
    const supabase = clientWith(
      (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch,
      () => {
        if (armed) throw new Error("cookie store unavailable");
        return [];
      }
    );
    // Let the construction-time session emit finish against the quiet getter.
    await new Promise((res) => setTimeout(res, 0));
    armed = true;

    await expect(supabase.auth.getUser()).rejects.toThrow("cookie store unavailable");
  });
});
