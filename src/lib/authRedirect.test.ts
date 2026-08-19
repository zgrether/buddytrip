import { describe, it, expect } from "vitest";
import {
  authCallbackUrl,
  signupConfirmationUrl,
  DEFAULT_SIGNUP_DESTINATION,
} from "./authRedirect";

/**
 * The one hop of §1.5's chain that can be pinned without a mailbox: the URL
 * handed to Supabase as `redirect_to`. Supabase stores this verbatim, puts it in
 * the confirmation mail, and bounces the browser to it after verifying the
 * token — so if `?next=` is right HERE it reaches /auth/callback, and if it
 * isn't, nothing downstream can recover it.
 */

const ORIGIN = "https://bbmi.app";

describe("authCallbackUrl", () => {
  it("carries a same-origin path through as ?next=", () => {
    expect(authCallbackUrl(ORIGIN, "/trips/abc-123")).toBe(
      "https://bbmi.app/auth/callback?next=%2Ftrips%2Fabc-123"
    );
  });

  it("omits ?next= entirely when there is nowhere in particular to go", () => {
    expect(authCallbackUrl(ORIGIN, null)).toBe("https://bbmi.app/auth/callback");
    expect(authCallbackUrl(ORIGIN, "")).toBe("https://bbmi.app/auth/callback");
  });

  it("preserves a query string on the destination", () => {
    expect(authCallbackUrl(ORIGIN, "/trips/abc?game=g1")).toBe(
      "https://bbmi.app/auth/callback?next=%2Ftrips%2Fabc%3Fgame%3Dg1"
    );
  });

  it("REFUSES an off-origin destination rather than repairing it", () => {
    // This value ends up in an emailed URL, so deny-by-default matters more here
    // than anywhere else in the chain.
    for (const hostile of [
      "https://evil.example/harvest",
      "//evil.example",
      "/\\evil.example",
      "@evil.example",
      "/\n//evil.example",
    ]) {
      expect(authCallbackUrl(ORIGIN, hostile)).toBe("https://bbmi.app/auth/callback");
    }
  });
});

describe("signupConfirmationUrl", () => {
  it("sends an ADDRESSED signup to where the link pointed", () => {
    expect(signupConfirmationUrl(ORIGIN, "/trips/abc-123")).toBe(
      "https://bbmi.app/auth/callback?next=%2Ftrips%2Fabc-123"
    );
  });

  it("keeps the dashboard fallback for a plain signup — a default, not a bug", () => {
    expect(signupConfirmationUrl(ORIGIN, null)).toBe(
      `https://bbmi.app/auth/callback?next=${encodeURIComponent(DEFAULT_SIGNUP_DESTINATION)}`
    );
  });

  it("falls back to the dashboard rather than honoring a hostile next", () => {
    expect(signupConfirmationUrl(ORIGIN, "https://evil.example")).toBe(
      `https://bbmi.app/auth/callback?next=${encodeURIComponent(DEFAULT_SIGNUP_DESTINATION)}`
    );
  });
});
