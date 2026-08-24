/**
 * Where the invite page sends someone who has no session, and where they come
 * back to afterwards.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 *
 * The handoff used to say "after you authenticate, go to /trips/{id}". That is
 * right for the person the invite was addressed to, and a dead end for anyone
 * else — which is a reachable case, not a hypothetical:
 *
 *   1. an owner invites Bradley at `brad+work@…`, an address Bradley reads but
 *      does not use for BuddyTrip
 *   2. Bradley, signed out, clicks the link and is offered SIGN-UP (correctly —
 *      that address has no account, only a placeholder)
 *   3. he takes the "Already have an account? Sign in" escape and signs in as
 *      `brad@…`
 *   4. `next` sends him straight to the trip, where he is not a member, and the
 *      page renders its no-access state
 *
 * He is now signed in, standing one row away from a placeholder that is his,
 * with nothing offering to connect the two. The identity-choice screen — the
 * one that CAN offer that — was skipped, because the handoff pointed past it.
 *
 * ── The fix, and why it is the return path rather than the screen ─────────
 *
 * Return to `/invite?token=…` instead of the trip. The invite page then
 * re-resolves with whatever session now exists and routes on the facts:
 *
 *   - signed up as the invited address → the DB merge has already run, he IS a
 *     member, `resolveAccessRoute` answers `go` and forwards to the trip. Same
 *     destination as before, one cheap hop later.
 *   - signed in as a different account → `identity-choice`, with the claim
 *     offer. The dead end becomes the case the claim was built for.
 *
 * Fixing it here rather than by teaching the trip page about invites keeps ONE
 * place deciding where an invited person goes, which is the property
 * `resolveAccessRoute` exists to preserve. Re-entering that decision is cheap;
 * duplicating it is how the two answers drift apart.
 *
 * No loop risk: the branch that produced this handoff requires NO viewer, and
 * arriving back here with a session cannot take it again.
 */

export type AuthHandoff = {
  mode: "signin" | "signup";
  token: string;
};

/** The path the invite page returns to after authentication. */
export function invitePostAuthPath(token: string): string {
  return `/invite?token=${encodeURIComponent(token)}`;
}

/** The full `/login` URL an unauthenticated invite visitor is sent to. */
export function buildAuthHandoff({ mode, token }: AuthHandoff): string {
  const next = invitePostAuthPath(token);
  return (
    `/login?mode=${mode}` +
    `&next=${encodeURIComponent(next)}` +
    `&invite=${encodeURIComponent(token)}`
  );
}
