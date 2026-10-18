import type { AccessRoute } from "@/lib/accessRoute";

/**
 * When a SPENT invite link leaves the visitor nothing that can work, say so on
 * the first screen (#1041).
 *
 * A link is spent once its placeholder was claimed: the invited address then
 * belongs to nobody. Two routes reach that dead end:
 *  - `authenticate` (no session): signing in or up with an address nobody
 *    holds would mint an empty account;
 *  - `identity-choice` for an account that CANNOT SEE the trip: "Continue as"
 *    needs that, there is no placeholder left to claim, and "Sign out and use
 *    the invited address" lands on the first case. So the only button on the
 *    screen ended the session and then said the invite was used.
 *
 * NOT refused, and each is pinned by a test:
 *  - a spent link opened by an account that CAN see the trip: "Continue as"
 *    is right there (the re-click a member makes);
 *  - a FRESH invite to a real account, opened by a different account. There is
 *    no placeholder there either, and signing out to use the invited address
 *    is exactly the right move. "No placeholder" alone is not a dead end, so
 *    the condition is `spent`, not the absence of a placeholder.
 */
export function spentLinkRefusal(
  route: AccessRoute,
  invite: { spent: boolean; tripName: string }
): { title: string; body: string } | null {
  if (!invite.spent) return null;
  const deadEnd =
    route.kind === "authenticate" || (route.kind === "identity-choice" && !route.viewerCanSee);
  if (!deadEnd) return null;
  return {
    title: "This invite has already been used",
    body:
      "Someone has already joined " +
      invite.tripName +
      " with this link. If that wasn't you, ask whoever invited you for a fresh one.",
  };
}
