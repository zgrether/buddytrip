import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveRouteCaller } from "./routeCaller";
import { AUTH_TIMEOUT_MS } from "@/lib/middlewareAuthTimeout";

/**
 * `resolveRouteCaller` fails CLOSED: a stall is a refusal here, where the
 * middleware deliberately passes the same stall through.
 */

const claims = (sub: string | null) => async () =>
  ({ data: sub ? { claims: { sub } } : null, error: null }) as const;
const noUser = async () => ({ data: { user: null }, error: null });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveRouteCaller", () => {
  it("a signed-in caller is admitted with their id", async () => {
    const r = await resolveRouteCaller({ getClaims: claims("user-1"), getUser: noUser });
    expect(r).toEqual({ ok: true, userId: "user-1" });
  });

  it("nobody signed in is a 401", async () => {
    const r = await resolveRouteCaller({ getClaims: claims(null), getUser: noUser });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("a STALL is a 503 — refused, not passed through", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = resolveRouteCaller({ getClaims: () => new Promise(() => {}), getUser: noUser });
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1);
    const r = await pending;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
  });

  it("an auth error that the fallback cannot answer is a 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await resolveRouteCaller({
      getClaims: async () => ({ data: null, error: new Error("bad JWKS") }),
      getUser: async () => {
        throw new Error("auth server unreachable");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
  });
});
