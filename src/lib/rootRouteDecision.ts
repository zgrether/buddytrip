/**
 * Where the root route sends someone — extracted so the timeout arm is
 * testable.
 *
 * `/` is the PWA's `start_url` (`manifest.ts`), so this is the LAUNCH path:
 * every time the installed app is opened from a home screen, this decision
 * runs. It is also the decision most likely to be got wrong under a stalled
 * auth server, because the obvious fallback — "we could not confirm a user, so
 * show the marketing page" — is exactly wrong for the person most affected: a
 * returning user on bad signal, who would be shown a signed-out landing page
 * for an app they are signed into.
 *
 * A pure function over three facts, so each arm can be asserted.
 */

export type RootDestination =
  | { kind: "marketing" }
  | { kind: "trip"; tripId: string }
  | { kind: "dashboard" };

export function rootRouteDecision(input: {
  /** True when `getUser()` did not answer in time. */
  timedOut: boolean;
  /** Whether a user was resolved. Meaningless when `timedOut`. */
  hasUser: boolean;
  /** `bt-last-trip-id`, written by the trip page on every visit. */
  lastTripId: string | undefined;
}): RootDestination {
  const { timedOut, hasUser, lastTripId } = input;

  if (timedOut) {
    /**
     * The cookie is the fallback answer, and it is a good one: the trip page
     * writes it on every visit, so its presence means this browser has been
     * signed in and inside a trip.
     *
     * Sending them there rather than to the marketing page keeps a returning
     * user moving. If the session really is dead, the trip route's own gate
     * bounces them to /login — the ordinary path, reached one hop later. What
     * must NOT happen is a timeout deciding someone is signed out (#1094), and
     * this arm never does.
     */
    return lastTripId ? { kind: "trip", tripId: lastTripId } : { kind: "marketing" };
  }

  if (!hasUser) return { kind: "marketing" };
  return lastTripId ? { kind: "trip", tripId: lastTripId } : { kind: "dashboard" };
}
