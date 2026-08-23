import { describe, it, expect } from "vitest";
import { buildAuthHandoff, invitePostAuthPath } from "./authHandoff";
import { safeNextPath } from "@/lib/nextPath";

/**
 * The regression these pin is a DESTINATION, so they assert the destination —
 * not that a URL was produced.
 *
 * Someone invited at an address they don't use for BuddyTrip, who signs out of
 * the sign-up form and signs in with their real account instead, used to be
 * dropped on a trip page that refuses them. The handoff has to come back
 * through `/invite`, where the claim can be offered. A test that only checked
 * "the URL contains the token" would have passed throughout the broken period.
 */

const TOKEN = "a".repeat(64);

describe("invite auth handoff", () => {
  it("returns to the INVITE page, never straight to the trip", () => {
    const url = buildAuthHandoff({ mode: "signup", token: TOKEN });
    // `URLSearchParams.get` already decodes once. Decoding again here would be
    // a no-op for this token and wrong for any token needing escapes — the
    // mistake the last case in this file exists to catch.
    const next = new URLSearchParams(url.split("?")[1]).get("next")!;

    expect(next).toBe(`/invite?token=${TOKEN}`);
    // The exact bug: `next` pointing at the trip skips the identity check.
    expect(next.startsWith("/trips/")).toBe(false);
  });

  it("survives safeNextPath, or the callback silently drops it", () => {
    // `/auth/callback` validates `next` and falls back to its own destination
    // when it fails — which would reintroduce the dead end quietly, with the
    // handoff still looking correct at the call site.
    const next = invitePostAuthPath(TOKEN);
    expect(safeNextPath(next)).toBe(next);
  });

  it("carries the mode chosen by the routing decision, unchanged", () => {
    expect(buildAuthHandoff({ mode: "signin", token: TOKEN })).toContain("mode=signin");
    expect(buildAuthHandoff({ mode: "signup", token: TOKEN })).toContain("mode=signup");
  });

  it("encodes the token in both places it appears", () => {
    const weird = "tok en&x=1";
    const url = buildAuthHandoff({ mode: "signin", token: weird });
    const params = new URLSearchParams(url.split("?")[1]);

    // Round-trips rather than matching the encoded literal: the point is that a
    // reader recovers the original token, not which escaping was used.
    expect(params.get("invite")).toBe(weird);
    expect(params.get("next")).toBe(`/invite?token=${encodeURIComponent(weird)}`);
  });
});
