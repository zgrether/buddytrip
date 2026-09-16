import { describe, it, expect } from "vitest";
import { createServerClient } from "@supabase/ssr";

/**
 * CONTRACT — what `supabase.auth.getClaims()` actually does inside a
 * `createServerClient` (@supabase/ssr), which is what `src/middleware.ts` runs on
 * every request. CLAUDE.md #23: a library's declared behaviour is not a runtime
 * guarantee, and the middleware's move from `getUser()` to `getClaims()` rests on
 * three properties no type signature states:
 *
 *  1. an EXPIRED access token is refreshed, and the rotated session is written
 *     back through the cookie adapter's `setAll` — the middleware is the token-
 *     refresh path, and a browser left holding a consumed refresh token is a hard
 *     mid-round logout;
 *  2. a VALID token is verified locally (WebCrypto against the JWKS) with no call
 *     to `/auth/v1/user` — the whole point of the change;
 *  3. a DEAD refresh token still produces cookie deletions through `setAll`, which
 *     the middleware's tRPC 401 forwards so the browser stops re-sending it.
 *
 * Driven through the REAL client with a fake `fetch`, a freshly generated ES256
 * key, and a session cookie in the real `base64-` encoding. Each test uses its own
 * project ref, because auth-js caches the JWKS module-wide per storage key.
 */

type Cookie = { name: string; value: string; options?: Record<string, unknown> };
type Mode = { refresh: "rotate" | "reused" };

let refCounter = 0;
const newRef = () => `ref${Date.now().toString(36)}${refCounter++}`;
const b64url = (data: ArrayBuffer | string) =>
  Buffer.from(typeof data === "string" ? data : new Uint8Array(data)).toString("base64url");

async function makeKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk: { ...pub, kid: "test-kid", alg: "ES256", use: "sig", key_ops: ["verify"] } };
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>, alg: "ES256" | "HS256" = "ES256") {
  const header = alg === "ES256" ? { alg, typ: "JWT", kid: "test-kid" } : { alg, typ: "JWT" };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const user = { id: "user-1", aud: "authenticated", role: "authenticated", email: "p0@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const claims = (exp: number) => ({ sub: "user-1", aud: "authenticated", role: "authenticated", exp, iat: exp - 3600, session_id: "sess-1", email: user.email });
const session = (access_token: string, refresh_token: string, expires_at: number) => ({
  access_token, refresh_token, expires_at, expires_in: expires_at - nowSec(), token_type: "bearer", user,
});

async function harness(opts: { accessExpired: boolean; mode: Mode; alg?: "ES256" | "HS256" }) {
  const ref = newRef();
  const url = `https://${ref}.supabase.co`;
  const { pair, jwk } = await makeKey();
  const accessExp = opts.accessExpired ? nowSec() - 60 : nowSec() + 3600;
  const access = await signJwt(pair.privateKey, claims(accessExp), opts.alg ?? "ES256");
  const rotated = await signJwt(pair.privateKey, claims(nowSec() + 3600));

  const calls: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${u.pathname}`);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/auth/v1/token") {
      return opts.mode.refresh === "rotate"
        ? json(200, session(rotated, "rt-rotated", nowSec() + 3600))
        : json(400, { code: 400, error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" });
    }
    if (u.pathname === "/auth/v1/.well-known/jwks.json") return json(200, { keys: [jwk] });
    if (u.pathname === "/auth/v1/user") return json(200, user);
    return json(404, {});
  };

  const written: Cookie[] = [];
  const make = (jar: Cookie[]) =>
    createServerClient(url, "anon-key", {
      cookies: { getAll: () => jar, setAll: (cs: Cookie[]) => void written.push(...cs) },
      global: { fetch: fakeFetch as typeof fetch },
    });

  const storageKey = (make([]).auth as unknown as { storageKey: string }).storageKey;
  const jar: Cookie[] = [
    { name: storageKey, value: "base64-" + b64url(JSON.stringify(session(access, "rt-original", accessExp))) },
  ];
  const settle = () => new Promise((r) => setTimeout(r, 25));
  const decode = (c: Cookie) => (c.value.startsWith("base64-") ? Buffer.from(c.value.slice(7), "base64url").toString("utf8") : c.value);
  return { make: () => make(jar), calls, written, storageKey, rotated, settle, decode };
}

const count = (calls: string[], call: string) => calls.filter((c) => c === call).length;

describe("getClaims inside createServerClient — the middleware's auth call", () => {
  it("EXPIRED access token: refreshes once, never calls /user, and rotates the cookie through setAll", async () => {
    const h = await harness({ accessExpired: true, mode: { refresh: "rotate" } });
    const { data, error } = await h.make().auth.getClaims();
    await h.settle();

    expect(error).toBeNull();
    expect(data?.claims.sub).toBe("user-1");
    expect(count(h.calls, "POST /auth/v1/token")).toBe(1);
    expect(count(h.calls, "GET /auth/v1/user")).toBe(0);

    const sessionCookies = h.written.filter((c) => c.name.startsWith(h.storageKey) && c.value !== "");
    expect(sessionCookies.length).toBeGreaterThan(0);
    const body = sessionCookies.map(h.decode).join("");
    expect(body).toContain("rt-rotated");
    expect(body).toContain(h.rotated);
  });

  it("VALID access token: verified locally — no refresh, no /user; the JWKS is fetched once and then cached", async () => {
    const h = await harness({ accessExpired: false, mode: { refresh: "rotate" } });
    const first = await h.make().auth.getClaims();
    const second = await h.make().auth.getClaims(); // a NEW client, as middleware makes per request

    expect(first.data?.claims.sub).toBe("user-1");
    expect(second.data?.claims.sub).toBe("user-1");
    expect(count(h.calls, "POST /auth/v1/token")).toBe(0);
    expect(count(h.calls, "GET /auth/v1/user")).toBe(0);
    expect(count(h.calls, "GET /auth/v1/.well-known/jwks.json")).toBe(1);
  });

  it("CONTROL: getUser() on the same valid token DOES call /user — the counter can see what the change removes", async () => {
    const h = await harness({ accessExpired: false, mode: { refresh: "rotate" } });
    const { data } = await h.make().auth.getUser();
    expect(data.user?.id).toBe("user-1");
    expect(count(h.calls, "GET /auth/v1/user")).toBe(1);
  });

  it("DEAD refresh token: no claims, and setAll still writes the cookie deletions the 401 path forwards", async () => {
    const h = await harness({ accessExpired: true, mode: { refresh: "reused" } });
    const { data } = await h.make().auth.getClaims();
    await h.settle();

    expect(data?.claims ?? null).toBeNull();
    expect(count(h.calls, "POST /auth/v1/token")).toBe(1);
    const deletions = h.written.filter((c) => c.name.startsWith(h.storageKey) && c.value === "");
    expect(deletions.length).toBeGreaterThan(0);
  });

  it("SYMMETRIC (HS256) token: falls back to /user, as documented — the local path needs asymmetric keys", async () => {
    const h = await harness({ accessExpired: false, mode: { refresh: "rotate" }, alg: "HS256" });
    await h.make().auth.getClaims();
    expect(count(h.calls, "GET /auth/v1/user")).toBe(1);
  });
});
