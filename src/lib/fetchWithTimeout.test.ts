import { describe, it, expect, vi } from "vitest";
import {
  fetchWithTimeout,
  CALLER_FETCH_TIMEOUT_MS,
  ADMIN_FETCH_TIMEOUT_MS,
} from "./fetchWithTimeout";

/**
 * The per-call bound (#1258), tested through a fake `fetch` so the abort is
 * observed rather than reasoned about.
 *
 * The failure this guards is a call that never returns. A test that only checks
 * "the signal is set" would pass against a wrapper that sets a signal nothing
 * watches — so every case below drives a fetch that HANGS and asserts what the
 * caller actually gets back.
 */

/** A fetch that never resolves on its own — it settles only if its signal aborts. */
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal → hangs forever, which is the bug
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason));
    })) as unknown as typeof fetch;
}

describe("fetchWithTimeout", () => {
  it("ABORTS a call that never returns — the whole point", async () => {
    const wrapped = fetchWithTimeout(30, hangingFetch());
    const started = Date.now();
    await expect(wrapped("https://example.test/slow")).rejects.toMatchObject({ name: "TimeoutError" });
    // It gave up on its own clock, not after some ambient timeout.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("lets a fast call through untouched, body and all", async () => {
    const base = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = fetchWithTimeout(5_000, base as unknown as typeof fetch);
    const res = await wrapped("https://example.test/fast");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("passes the request's own init through, and adds a signal", async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
    const wrapped = fetchWithTimeout(5_000, base as unknown as typeof fetch);
    await wrapped("https://example.test/x", { method: "POST", headers: { apikey: "k" }, body: "{}" });
    const init = base.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).apikey).toBe("k");
    expect(init.body).toBe("{}");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("KEEPS the caller's own cancellation working — supabase-js passes one", async () => {
    // Replacing the caller's signal instead of composing with it would make
    // every cancellation supabase-js issues silently inert.
    const wrapped = fetchWithTimeout(60_000, hangingFetch());
    const caller = new AbortController();
    const p = wrapped("https://example.test/cancel-me", { signal: caller.signal });
    caller.abort(new Error("caller changed its mind"));
    await expect(p).rejects.toThrow("caller changed its mind");
  });

  it("the two values are the ones the corridor argues for, and are ordered", () => {
    // 8s: above the slowest legitimate request measured (5.7s), at Postgres's own
    // statement_timeout (8s). 20s: the looser stay for the service-role client
    // until the manual results write is atomic (#1398).
    expect(CALLER_FETCH_TIMEOUT_MS).toBe(8_000);
    expect(ADMIN_FETCH_TIMEOUT_MS).toBe(20_000);
    expect(CALLER_FETCH_TIMEOUT_MS).toBeGreaterThan(5_700);
    expect(ADMIN_FETCH_TIMEOUT_MS).toBeGreaterThan(CALLER_FETCH_TIMEOUT_MS);
    // …and both stay well under the route's 60s backstop, or the backstop would
    // be the thing that fires and the per-call bound would be decorative.
    expect(ADMIN_FETCH_TIMEOUT_MS).toBeLessThan(60_000);
  });
});

describe("the clients are actually wired to it (source guard)", () => {
  it("the request's client takes the caller bound and the service client the admin bound", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const server = readFileSync(join(__dirname, "supabase-server.ts"), "utf8");
    const admin = readFileSync(join(__dirname, "supabase-admin.ts"), "utf8");
    expect(server).toMatch(/global:\s*\{\s*fetch:\s*fetchWithTimeout\(CALLER_FETCH_TIMEOUT_MS\)/);
    expect(admin).toMatch(/global:\s*\{\s*fetch:\s*fetchWithTimeout\(ADMIN_FETCH_TIMEOUT_MS\)/);
    // The browser client is deliberately NOT wired: it is also the Realtime
    // singleton, and its REST traffic is mostly auth refresh, where an 8s abort
    // on a bad course connection would turn a slow refresh into a failed one.
    const browser = readFileSync(join(__dirname, "supabase.ts"), "utf8");
    expect(browser).not.toContain("fetchWithTimeout");
  });
});
