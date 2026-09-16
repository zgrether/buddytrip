import { describe, it, expect, vi } from "vitest";
import { resolveMiddlewareUser, type MiddlewareAuth } from "./middlewareUser";

/**
 * The decision the middleware makes from the auth client. The library half — that
 * `getClaims()` refreshes, rotates cookies and skips `/user` — is pinned by
 * `supabaseGetClaims.contract.test.ts`; this pins what the middleware does with
 * each answer, and above all WHEN it pays for the network call.
 */

function fakeAuth(claims: Awaited<ReturnType<MiddlewareAuth["getClaims"]>>, user: { id: string } | null = null) {
  return {
    getClaims: vi.fn(async () => claims),
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
}

describe("resolveMiddlewareUser", () => {
  it("a verified token is the user — and costs no getUser() round trip", async () => {
    const auth = fakeAuth({ data: { claims: { sub: "user-1" } }, error: null });
    expect(await resolveMiddlewareUser(auth)).toEqual({ id: "user-1" });
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("no session is not an error: null, and still no network call", async () => {
    const auth = fakeAuth({ data: null, error: null });
    expect(await resolveMiddlewareUser(auth)).toBeNull();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("a claims ERROR (failed JWKS fetch, bad signature) falls back to getUser()", async () => {
    const auth = fakeAuth({ data: null, error: new Error("jwks unavailable") }, { id: "user-1" });
    expect(await resolveMiddlewareUser(auth)).toEqual({ id: "user-1" });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("a claims error that getUser() cannot recover from is signed out", async () => {
    const auth = fakeAuth({ data: null, error: new Error("refresh_token_already_used") }, null);
    expect(await resolveMiddlewareUser(auth)).toBeNull();
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("claims without a usable sub are not a user", async () => {
    const auth = fakeAuth({ data: { claims: { sub: "" } }, error: null });
    expect(await resolveMiddlewareUser(auth)).toBeNull();
  });

  it("a non-auth THROW propagates, so the timeout race still reports it as rejected", async () => {
    const auth = {
      getClaims: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      getUser: vi.fn(),
    };
    await expect(resolveMiddlewareUser(auth as unknown as MiddlewareAuth)).rejects.toThrow("fetch failed");
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});
