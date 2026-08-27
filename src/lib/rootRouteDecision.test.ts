import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { rootRouteDecision } from "./rootRouteDecision";

/**
 * The PWA launch decision.
 *
 * `/` is `start_url`, so these four cases ARE what happens when the installed
 * app is opened from a home screen. The timeout arm is the one worth having a
 * test for: it is where the obvious implementation is wrong.
 */

describe("rootRouteDecision — the normal paths", () => {
  it("no user → marketing", () => {
    expect(rootRouteDecision({ timedOut: false, hasUser: false, lastTripId: undefined }))
      .toEqual({ kind: "marketing" });
  });

  it("user with a last trip → that trip", () => {
    expect(rootRouteDecision({ timedOut: false, hasUser: true, lastTripId: "t1" }))
      .toEqual({ kind: "trip", tripId: "t1" });
  });

  it("user with no last trip → dashboard", () => {
    expect(rootRouteDecision({ timedOut: false, hasUser: true, lastTripId: undefined }))
      .toEqual({ kind: "dashboard" });
  });

  it("a stale cookie does NOT override a resolved absence of user", () => {
    // When auth actually answered, believe it. The cookie is a fallback, not a
    // second opinion — otherwise a signed-out browser with an old cookie could
    // never reach the marketing page at all.
    expect(rootRouteDecision({ timedOut: false, hasUser: false, lastTripId: "t1" }))
      .toEqual({ kind: "marketing" });
  });
});

describe("rootRouteDecision — the timeout arm", () => {
  it("A RETURNING USER IS NOT SHOWN MARKETING when auth stalls", () => {
    // The whole point. The obvious fallback — "unconfirmed, so show the
    // signed-out landing page" — is exactly wrong for the person most affected:
    // someone on bad signal opening an app they are signed into.
    expect(rootRouteDecision({ timedOut: true, hasUser: false, lastTripId: "t1" }))
      .toEqual({ kind: "trip", tripId: "t1" });
  });

  it("...and `hasUser` is ignored entirely on timeout, because it means nothing", () => {
    // Whatever `hasUser` happens to be when the call did not answer, it is not
    // information. Both values must give the same destination.
    const a = rootRouteDecision({ timedOut: true, hasUser: false, lastTripId: "t1" });
    const b = rootRouteDecision({ timedOut: true, hasUser: true, lastTripId: "t1" });
    expect(a).toEqual(b);
  });

  it("with no cookie, an unknown visitor still gets marketing", () => {
    // No evidence of a prior session — marketing is what they would have got
    // anyway, so a stall costs them nothing.
    expect(rootRouteDecision({ timedOut: true, hasUser: false, lastTripId: undefined }))
      .toEqual({ kind: "marketing" });
  });

  it("NEVER routes to login — a timeout must not sign anyone out (#1094)", () => {
    // Asserted across every input combination rather than the interesting one,
    // so the rule cannot be broken by a case nobody thought to check.
    for (const hasUser of [true, false]) {
      for (const lastTripId of ["t1", undefined]) {
        const d = rootRouteDecision({ timedOut: true, hasUser, lastTripId });
        expect(JSON.stringify(d)).not.toContain("login");
      }
    }
  });
});

describe("the root route actually uses the guard", () => {
  const source = readFileSync(join(__dirname, "..", "app", "page.tsx"), "utf8");

  it("races its auth call instead of awaiting it bare", () => {
    // `/` is the launch path and had a bare `await supabase.auth.getUser()`.
    // Guarding only the middleware (#1095) left this hang in place, which is
    // why a reported failure ran to minutes rather than one 25s ceiling.
    expect(source).toContain("resolveWithTimeout");
    expect(source).not.toMatch(/await\s+supabase\.auth\.getUser\(\)/);
  });

  it("logs the stall with the shared probe line", () => {
    expect(source).toContain("authProbeLine");
  });

  it("CALLS rootRouteDecision rather than re-deriving the arms inline", () => {
    // Caught before shipping: the first version extracted this function, tested
    // all four arms, and left `page.tsx` branching inline — so every assertion
    // above described a function the launch path did not call. A tested
    // function nothing uses is decorative, and worse than no test, because it
    // reads as coverage.
    expect(source).toContain("rootRouteDecision({");
    // ...and the inline branching it replaced is gone.
    expect(source).not.toMatch(/if \(!user\) \{\s*return <MarketingPage/);
  });
});
