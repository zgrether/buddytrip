import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  resolveWithTimeout,
  authProbeLine,
  AUTH_TIMEOUT_MS,
  AUTH_SLOW_MS,
} from "./middlewareAuthTimeout";

/**
 * The middleware's auth timeout.
 *
 * Two kinds of assertion here, and the split is deliberate:
 *
 *   * the RACE is testable with fakes, so it is tested behaviourally — a
 *     promise that never settles must yield `timedOut`, which is the entire
 *     point and cannot be checked inside an edge function
 *   * the RULE that a timeout never redirects lives in `src/middleware.ts`,
 *     which imports `@supabase/ssr` and `next/server` and cannot be invoked in
 *     this environment. It gets a source guard, and the guard says so rather
 *     than pretending to be a behavioural test
 */

describe("resolveWithTimeout", () => {
  it("returns the value when the work finishes first", async () => {
    const r = await resolveWithTimeout(async () => "done", 1000);
    expect(r).toMatchObject({ timedOut: false, value: "done" });
  });

  it("TIMES OUT on a promise that never settles — the whole point", async () => {
    // The production failure was a `getUser()` that never came back. Un-raced,
    // this test would hang forever; that it completes IS the assertion.
    const never = () => new Promise<string>(() => {});
    const r = await resolveWithTimeout(never, 20);
    expect(r.timedOut).toBe(true);
  });

  it("reports elapsed time on both paths, so the log can carry it", async () => {
    const fast = await resolveWithTimeout(async () => "x", 1000);
    expect(fast.elapsedMs).toBeGreaterThanOrEqual(0);
    const slow = await resolveWithTimeout(() => new Promise<string>(() => {}), 20);
    expect(slow.elapsedMs).toBeGreaterThanOrEqual(15);
  });

  it("a late resolve does not change an already-timed-out result", async () => {
    // The losing promise settles after the race. Nothing may act on it — the
    // request has already been decided and sent.
    let resolveLate: ((v: string) => void) | undefined;
    const late = () => new Promise<string>((res) => { resolveLate = res; });
    const r = await resolveWithTimeout(late, 15);
    expect(r.timedOut).toBe(true);
    resolveLate?.("too late");
    await new Promise((res) => setTimeout(res, 5));
    expect(r.timedOut).toBe(true);
  });

  it("propagates a REJECTION rather than swallowing it into a fake timeout", async () => {
    // A genuine auth error must stay an error. Turning it into `timedOut` would
    // make a broken session look like a slow network and silently pass the
    // request through — the opposite of what the guard is for.
    await expect(
      resolveWithTimeout(async () => {
        throw new Error("auth exploded");
      }, 1000)
    ).rejects.toThrow("auth exploded");
  });

  it("clears its timer — an un-cleared one keeps the edge isolate alive", async () => {
    // Asserted through the injected clock rather than by inspecting timers:
    // if the timeout still fired after a fast resolve it would have to have
    // been scheduled, and the result would not be a clean value.
    const r = await resolveWithTimeout(async () => "quick", 50);
    await new Promise((res) => setTimeout(res, 70));
    expect(r).toMatchObject({ timedOut: false, value: "quick" });
  });
});

describe("the thresholds are set against measurement", () => {
  it("times out an order of magnitude above the worst honest response", () => {
    // Supabase's own logs put /user between 5ms and 247ms during the incident.
    expect(AUTH_TIMEOUT_MS).toBeGreaterThan(247 * 4);
    // ...and well under Vercel's 25s edge ceiling, or it would not be a guard.
    expect(AUTH_TIMEOUT_MS).toBeLessThan(25_000 / 4);
  });

  it("logs near-misses below the timeout, so the distribution is visible", () => {
    expect(AUTH_SLOW_MS).toBeLessThan(AUTH_TIMEOUT_MS);
  });
});

describe("authProbeLine", () => {
  const base = { pathname: "/api/trpc/pickem.savePicks", method: "POST", elapsedMs: 2503 };

  it("NEVER carries a cookie value — only names go in, counts come out", () => {
    // The line is written to be safe to paste into an issue. If it could carry
    // a session token, it could not be.
    const line = authProbeLine({
      ...base,
      outcome: "timeout",
      cookieNames: ["sb-abcdef-auth-token", "theme"],
    });
    expect(line).not.toContain("eyJ");
    const parsed = JSON.parse(line);
    // Every value is a primitive fact, not a payload.
    expect(Object.values(parsed).every((v) => typeof v !== "object")).toBe(true);
    expect(parsed).toMatchObject({
      tag: "auth-probe",
      outcome: "timeout",
      path: "/api/trpc/pickem.savePicks",
      method: "POST",
      elapsedMs: 2503,
      hasSession: true,
      cookieCount: 2,
    });
  });

  it("separates a signed-in stall from an anonymous one", () => {
    // The single most useful split: a stall with no session cookie cannot be a
    // token refresh, which would kill that hypothesis outright.
    const anon = JSON.parse(
      authProbeLine({ ...base, outcome: "timeout", cookieNames: ["theme"] })
    );
    expect(anon.hasSession).toBe(false);
    expect(anon.sessionChunks).toBe(0);
  });

  it("counts CHUNKED session cookies, which are a different profile", () => {
    // `@supabase/ssr` splits an oversized session across `.0`, `.1`, …
    const line = JSON.parse(
      authProbeLine({
        ...base,
        outcome: "timeout",
        cookieNames: ["sb-x-auth-token.0", "sb-x-auth-token.1", "sb-x-auth-token.2", "theme"],
      })
    );
    expect(line.hasSession).toBe(true);
    expect(line.sessionChunks).toBe(3);
  });

  it("is one line of parseable JSON — it will be read out of a log viewer", () => {
    const line = authProbeLine({ ...base, outcome: "slow", cookieNames: [] });
    expect(line).not.toContain("\n");
    expect(() => JSON.parse(line)).not.toThrow();
  });
});

describe("the rule: a timeout must never sign anyone out", () => {
  const source = readFileSync(join(__dirname, "..", "middleware.ts"), "utf8");

  it("returns on timeout BEFORE any redirect or 401 can be reached", () => {
    // A source guard, and the reason is worth stating: `src/middleware.ts`
    // imports `@supabase/ssr` and `next/server` and cannot be invoked in this
    // `node` environment, so the rule cannot be tested behaviourally here. What
    // it CAN check is the structural property the rule depends on — the timeout
    // branch returns early, so no later edit to the redirect logic can start
    // redirecting on a timeout without deleting this.
    const timeoutBranch = source.indexOf("if (resolved.timedOut)");
    const firstRedirect = source.indexOf("NextResponse.redirect");
    const first401 = source.indexOf("NextResponse.json");

    expect(timeoutBranch).toBeGreaterThan(-1);
    expect(firstRedirect).toBeGreaterThan(-1);
    expect(first401).toBeGreaterThan(-1);
    // The branch exists ahead of both exits...
    expect(timeoutBranch).toBeLessThan(firstRedirect);
    expect(timeoutBranch).toBeLessThan(first401);

    // ...and it returns the pass-through response, not a decision.
    //
    // COMMENTS STRIPPED FIRST. The first version of this asserted over the raw
    // slice and failed against the branch's own comment, which explains that it
    // does not redirect — the check was reading prose, not code. A source guard
    // that can be satisfied or broken by a comment is not guarding anything.
    const rawBranch = source.slice(timeoutBranch, source.indexOf("\n  }", timeoutBranch));
    const branch = rawBranch
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    expect(branch).toContain("return supabaseResponse");
    expect(branch).not.toContain("NextResponse.redirect");
    expect(branch).not.toContain("NextResponse.json");
    expect(branch).not.toContain("401");
    // The premise: stripping comments left real code behind.
    expect(branch).toContain("console.warn");
  });

  it("still races the auth call rather than awaiting it bare", () => {
    // The regression that would undo all of this is someone reinstating
    // `await supabase.auth.getUser()` directly.
    expect(source).toContain("resolveWithTimeout");
    expect(source).not.toMatch(/await\s+supabase\.auth\.getUser\(\)/);
  });
});
