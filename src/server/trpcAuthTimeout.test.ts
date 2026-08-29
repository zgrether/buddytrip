import { describe, it, expect, vi } from "vitest";
import { resolveWithTimeout, authProbeLine, AUTH_TIMEOUT_MS } from "@/lib/middlewareAuthTimeout";

/**
 * The tRPC context's auth guard.
 *
 * The behaviour under test is a decision table, not a network call, so it is
 * tested as one: given a stalled `getUser()` and a set of cookies, does a
 * signed-in caller get a RETRYABLE error and an anonymous caller get through?
 *
 * The context itself cannot be imported here — it pulls in `next/headers` and
 * the Supabase server client — so this pins the two pieces the decision is made
 * from, and `trpc.ts` is written to use exactly these.
 */

/** The predicate `createTRPCContext` uses to tell the two callers apart. */
const hasSession = (cookieNames: string[]) =>
  cookieNames.some((n) => n.startsWith("sb-") && n.includes("auth-token"));

describe("a stall must not sign anyone out", () => {
  it("treats a chunked session cookie as a session", () => {
    // `@supabase/ssr` splits an oversized session across `.0`, `.1`, … and the
    // production probe showed `sessionChunks: 2` on the stalling requests — so
    // a check that only matched the unchunked name would read the very people
    // this fires for as anonymous, and sign them out.
    expect(hasSession(["sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
    expect(hasSession(["sb-abc-auth-token"])).toBe(true);
  });

  it("treats a request with no session cookie as anonymous", () => {
    // Nothing to sign out, and refusing them would break the public procedures
    // they legitimately call.
    expect(hasSession(["theme", "sb-abc-other"])).toBe(false);
    expect(hasSession([])).toBe(false);
  });
});

describe("resolveWithTimeout, as the context uses it", () => {
  it("gives up on a promise that never settles rather than hanging", async () => {
    /**
     * The whole point. Un-raced, this is a 300-second serverless invocation —
     * observed in production as `Task timed out after 300 seconds` on
     * `pickem.get`.
     */
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => {});
      const p = resolveWithTimeout(() => never, AUTH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1);
      const resolved = await p;
      expect(resolved.timedOut).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a fast answer straight through", async () => {
    // The common case must be untouched: `getUser()` normally answers in
    // single-digit milliseconds, and the guard must not change that path.
    const resolved = await resolveWithTimeout(async () => ({ ok: true }), AUTH_TIMEOUT_MS);
    expect(resolved.timedOut).toBe(false);
    if (!resolved.timedOut) expect(resolved.value).toEqual({ ok: true });
  });

  it("uses ONE ceiling everywhere, so incidents stay comparable", () => {
    // Middleware, the home page, the invite page and the tRPC context all race
    // against this number. A second arbitrary threshold would make the next
    // incident's durations impossible to compare against these two.
    expect(AUTH_TIMEOUT_MS).toBe(2500);
  });
});

describe("the timeout is its own event", () => {
  it("names the SURFACE, so a third incident can be matched to these two", () => {
    /**
     * Two incidents, no identified trigger. The question on a third is whether
     * it is the same shape — same duration, same endpoint, same token state,
     * same place in the request — and that is only answerable if every timeout
     * is recorded distinctly and identically.
     */
    const line = (surface: "middleware" | "home" | "invite" | "trpc") =>
      JSON.parse(
        authProbeLine({
          surface,
          cookieNames: ["sb-abc-auth-token.0", "sb-abc-auth-token.1", "theme"],
          pathname: "/api/trpc/pickem.get",
          method: "POST",
          elapsedMs: 2500,
          outcome: "timeout",
        })
      );

    for (const s of ["middleware", "home", "invite", "trpc"] as const) {
      expect(line(s).surface, s).toBe(s);
      // One tag across all four, so they aggregate; one field to split them.
      expect(line(s).tag).toBe("auth-probe");
      expect(line(s).outcome).toBe("timeout");
    }

    // The comparison fields the next incident needs, all present on one line.
    const l = line("trpc");
    expect(l.elapsedMs).toBe(2500);
    expect(l.path).toBe("/api/trpc/pickem.get");
    expect(l.hasSession).toBe(true);
    expect(l.sessionChunks).toBe(2);
  });

  it("still cannot carry a token", () => {
    // The line is written to be safe to paste into an issue; adding a field
    // must not change that.
    const line = authProbeLine({
      surface: "trpc",
      cookieNames: ["sb-abc-auth-token=eyJhbGciOi", "theme"],
      pathname: "/api/trpc/pickem.get",
      method: "POST",
      elapsedMs: 2500,
      outcome: "timeout",
    });
    expect(line).not.toContain("eyJ");
  });
});
