import { describe, it, expect } from "vitest";
import { resolveAccessRoute, type AccessRouteInput } from "./accessRoute";

/**
 * The four branches of the deep-link rule, plus the cases that decide which one
 * you land in. Kept exhaustive on purpose: three of the four are failure paths
 * nobody exercises by hand, and the FOURTH — "already signed in, goes straight
 * there" — is the success case that gets skipped in review precisely because it
 * looks like nothing happens. (That is how the account-deletion regression
 * shipped: the guard's success case was the one nobody checked.)
 */

const TRIP = { path: "/trips/abc-123", resourceName: "BBMI Playground" };

const input = (over: Partial<AccessRouteInput>): AccessRouteInput => ({
  target: TRIP,
  viewer: null,
  viewerCanSeeTarget: false,
  addressee: null,
  ...over,
});

describe("resolveAccessRoute — branch 1: the invited person, already signed in", () => {
  it("goes straight to the resource, with no interstitial", () => {
    expect(
      resolveAccessRoute(
        input({
          viewer: { id: "u1", email: "brad@work.com" },
          viewerCanSeeTarget: true,
          addressee: { email: "brad@work.com", hasAccount: true },
        })
      )
    ).toEqual({ kind: "go", path: "/trips/abc-123" });
  });

  it("matches the address case- and whitespace-insensitively", () => {
    expect(
      resolveAccessRoute(
        input({
          viewer: { id: "u1", email: "  Brad@Work.com " },
          viewerCanSeeTarget: true,
          addressee: { email: "brad@work.com", hasAccount: true },
        })
      )
    ).toMatchObject({ kind: "go" });
  });

  it("a plain link (no addressee) still goes straight there when the viewer can see it", () => {
    expect(
      resolveAccessRoute(
        input({ viewer: { id: "u1", email: "anyone@x.com" }, viewerCanSeeTarget: true })
      )
    ).toEqual({ kind: "go", path: "/trips/abc-123" });
  });
});

describe("resolveAccessRoute — branch 2: a session on a different account", () => {
  it("never resolves silently — offers the choice, and says which address was invited", () => {
    const route = resolveAccessRoute(
      input({
        viewer: { id: "u2", email: "someone-else@x.com" },
        viewerCanSeeTarget: false,
        addressee: { email: "brad@work.com", hasAccount: false },
      })
    );
    expect(route).toEqual({
      kind: "identity-choice",
      next: "/trips/abc-123",
      invitedEmail: "brad@work.com",
      viewerCanSee: false,
    });
  });

  it("identity is checked BEFORE access — a different account that IS a member still gets asked", () => {
    // The shared-device case. "It just worked" is how someone ends up entering
    // scores under a housemate's name.
    const route = resolveAccessRoute(
      input({
        viewer: { id: "u2", email: "someone-else@x.com" },
        viewerCanSeeTarget: true,
        addressee: { email: "brad@work.com", hasAccount: true },
      })
    );
    expect(route).toMatchObject({ kind: "identity-choice", viewerCanSee: true });
  });
});

describe("resolveAccessRoute — branches 3 & 4: no session", () => {
  it("branch 3 — the invited address has an account → sign IN, prefilled", () => {
    expect(
      resolveAccessRoute(input({ addressee: { email: "brad@work.com", hasAccount: true } }))
    ).toEqual({
      kind: "authenticate",
      mode: "signin",
      next: "/trips/abc-123",
      prefillEmail: "brad@work.com",
    });
  });

  it("branch 4 — no account → sign UP, prefilled (this is #980: never 'Welcome back')", () => {
    expect(
      resolveAccessRoute(input({ addressee: { email: "brad@work.com", hasAccount: false } }))
    ).toEqual({
      kind: "authenticate",
      mode: "signup",
      next: "/trips/abc-123",
      prefillEmail: "brad@work.com",
    });
  });

  it("a plain link with no addressee falls back to sign-in with nothing prefilled", () => {
    expect(resolveAccessRoute(input({}))).toEqual({
      kind: "authenticate",
      mode: "signin",
      next: "/trips/abc-123",
      prefillEmail: null,
    });
  });
});

describe("resolveAccessRoute — the states with nowhere to route", () => {
  it("no target at all is unresolvable, whoever is looking", () => {
    expect(resolveAccessRoute(input({ target: null }))).toEqual({ kind: "unresolvable" });
    expect(
      resolveAccessRoute(
        input({ target: null, viewer: { id: "u1", email: "brad@work.com" }, viewerCanSeeTarget: true })
      )
    ).toEqual({ kind: "unresolvable" });
  });

  it("the invited person, signed in, but no longer on the roster → say so, don't bounce them", () => {
    expect(
      resolveAccessRoute(
        input({
          viewer: { id: "u1", email: "brad@work.com" },
          viewerCanSeeTarget: false,
          addressee: { email: "brad@work.com", hasAccount: true },
        })
      )
    ).toEqual({ kind: "no-access" });
  });

  it("a viewer with no email on the session is treated as a different identity, not a match", () => {
    expect(
      resolveAccessRoute(
        input({
          viewer: { id: "u1", email: null },
          viewerCanSeeTarget: true,
          addressee: { email: "brad@work.com", hasAccount: true },
        })
      )
    ).toMatchObject({ kind: "identity-choice" });
  });
});
