import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TRPCClientError } from "@trpc/client";
import { membershipLost, NoLongerAMember } from "./TripMembershipGate";
import {
  GATE_UNAVAILABLE_MESSAGE,
  NOT_A_MEMBER_MESSAGE,
  isNotAMemberError,
} from "@/lib/tripAccessMessages";

/**
 * The removed person's exit (PR 8d-3).
 *
 * The rule the gate must never break: nobody is told they were removed from a
 * trip on the strength of a check that did not answer. So the false cases here
 * matter more than the true one — and the true one is the control that proves
 * the predicate CAN say yes, built from the same error shape tRPC's client
 * really produces (a `TRPCClientError` carrying `data.code`), not a literal.
 */

/** The error tRPC's client raises for a procedure error — the real class. */
function clientError(message: string, code: string) {
  return new TRPCClientError(message, {
    result: { error: { message, code: -32603, data: { code, httpStatus: 403 } } },
  } as never);
}

const ME = "user-me";
const roster = [{ user_id: ME }, { user_id: "someone-else" }];

describe("isNotAMemberError — only the gate's real 'no'", () => {
  it("CONTROL: the membership gate's refusal is recognised", () => {
    expect(isNotAMemberError(clientError(NOT_A_MEMBER_MESSAGE, "FORBIDDEN"))).toBe(true);
  });

  it("a gate that could not run is NOT a refusal", () => {
    expect(isNotAMemberError(clientError(GATE_UNAVAILABLE_MESSAGE, "INTERNAL_SERVER_ERROR"))).toBe(false);
  });

  it("FORBIDDEN for some other reason (a role check) is not a lost membership", () => {
    expect(isNotAMemberError(clientError("Only the trip owner can do that.", "FORBIDDEN"))).toBe(false);
  });

  it("the sentence under any other code is not it either", () => {
    expect(isNotAMemberError(clientError(NOT_A_MEMBER_MESSAGE, "INTERNAL_SERVER_ERROR"))).toBe(false);
    expect(isNotAMemberError(new Error(NOT_A_MEMBER_MESSAGE))).toBe(false);
    expect(isNotAMemberError(null)).toBe(false);
  });
});

describe("membershipLost — when the open app says so", () => {
  const refused = clientError(NOT_A_MEMBER_MESSAGE, "FORBIDDEN");

  it("CONTROL: they were on the roster this app last read, and the re-read refuses them", () => {
    expect(membershipLost({ userId: ME, members: roster, error: refused, leftHereKnown: false })).toBe(true);
  });

  it("a cold open of a trip they were already gone from: nothing was taken while they watched", () => {
    expect(membershipLost({ userId: ME, members: undefined, error: refused, leftHereKnown: false })).toBe(false);
  });

  it("the re-read could not run: say nothing", () => {
    const unavailable = clientError(GATE_UNAVAILABLE_MESSAGE, "INTERNAL_SERVER_ERROR");
    expect(membershipLost({ userId: ME, members: roster, error: unavailable, leftHereKnown: false })).toBe(false);
  });

  it("they LEFT, from this device: they know, and are already on their way out", () => {
    expect(membershipLost({ userId: ME, members: roster, error: refused, leftHereKnown: true })).toBe(false);
  });

  it("a roster that never held them is not one they were removed from", () => {
    expect(
      membershipLost({ userId: ME, members: [{ user_id: "someone-else" }], error: refused, leftHereKnown: false })
    ).toBe(false);
  });

  it("no error: still a member", () => {
    expect(membershipLost({ userId: ME, members: roster, error: null, leftHereKnown: false })).toBe(false);
  });
});

describe("NoLongerAMember — the screen", () => {
  it("says the ruled sentence and offers the way out", () => {
    const html = renderToStaticMarkup(<NoLongerAMember />);
    expect(html).toContain("You’re no longer a member of this trip.");
    expect(html).toMatch(/<a[^>]*href="\/dashboard"[^>]*>Go to your trips<\/a>/);
  });
});
