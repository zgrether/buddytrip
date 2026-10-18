import { describe, it, expect } from "vitest";
import { resolveAccessRoute, type AccessRouteInput } from "@/lib/accessRoute";
import { spentLinkRefusal } from "./spentLink";

/**
 * #1041 — a SPENT invite link that leaves the visitor nothing that can work
 * says so on the first screen.
 *
 * Every case goes through the real `resolveAccessRoute` with the inputs the
 * page hands it, so the route under test is the one the page gets. `spent` is
 * what `resolveInviteLink` resolves: the link was claimed and its address now
 * belongs to nobody (`hasAccount: false`).
 *
 * The case to watch is the last CONTROL: a FRESH invite to a real account,
 * opened by a different account. It has no placeholder either, and there
 * "Sign out and use the invited address" is the right answer, so a condition
 * keyed on "no placeholder" would refuse a working invite.
 */

const TRIP = { path: "/trips/t1", resourceName: "Lake Weekend" };
const VIEWER = { id: "u-other", email: "someone.else@example.com" };

function refusal(input: Partial<AccessRouteInput>, spent: boolean) {
  const route = resolveAccessRoute({
    target: TRIP,
    viewer: null,
    viewerCanSeeTarget: false,
    addressee: null,
    ...input,
  });
  return { kind: route.kind, refusal: spentLinkRefusal(route, { spent, tripName: TRIP.resourceName }) };
}

describe("spentLinkRefusal", () => {
  it("a spent link, signed in as an account that CAN'T see the trip: refused on the first screen", () => {
    const out = refusal(
      { viewer: VIEWER, viewerCanSeeTarget: false, addressee: { email: "invited@example.com", hasAccount: false } },
      true
    );
    expect(out.kind).toBe("identity-choice");
    expect(out.refusal).toEqual({
      title: "This invite has already been used",
      body: "Someone has already joined Lake Weekend with this link. If that wasn't you, ask whoever invited you for a fresh one.",
    });
  });

  it("a spent link with no session: refused, as before", () => {
    const out = refusal({ addressee: { email: "invited@example.com", hasAccount: false } }, true);
    expect(out.kind).toBe("authenticate");
    expect(out.refusal?.title).toBe("This invite has already been used");
  });

  it("CONTROL: a spent link opened by a MEMBER is not refused; Continue is the way in", () => {
    const out = refusal(
      { viewer: VIEWER, viewerCanSeeTarget: true, addressee: { email: "invited@example.com", hasAccount: false } },
      true
    );
    expect(out.kind).toBe("identity-choice");
    expect(out.refusal).toBeNull();
  });

  it("CONTROL: a FRESH invite to a real account, opened by a different account, is not refused", () => {
    // No placeholder here either: the invite names a real account. Signing out
    // and using that address is exactly right, so this must stay a choice.
    const out = refusal(
      { viewer: VIEWER, viewerCanSeeTarget: false, addressee: { email: "invited@example.com", hasAccount: true } },
      false
    );
    expect(out.kind).toBe("identity-choice");
    expect(out.refusal).toBeNull();
  });

  it("CONTROL: a fresh invite with no session is not refused", () => {
    expect(refusal({ addressee: { email: "invited@example.com", hasAccount: false } }, false).refusal).toBeNull();
  });
});
