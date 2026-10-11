/**
 * The two answers the trip membership gate gives, as the CLIENT needs to tell
 * them apart (PR 8d-3). They live here, not in `server/middleware.ts`, because
 * that module is server code; the middleware re-exports them so there is one
 * spelling of each.
 *
 * The distinction is the point. A removed person's open app says so
 * (`TripMembershipGate`), and it may say so ONLY on the first: the second is a
 * check that did not run, and nobody is told they were removed from a trip on
 * the strength of a query that did not answer.
 */

/** The trip membership check RAN and the answer was no. A real refusal. */
export const NOT_A_MEMBER_MESSAGE = "You are not a member of this trip";

/**
 * The trip membership check COULD NOT RUN. Not a refusal — we do not know.
 *
 * Names the failed check rather than a conclusion, and gives the one action
 * that helps (wait, retry), because the conditions that produce it are
 * transient by nature. Never tell someone they have been removed from a trip
 * on the strength of a query that did not answer.
 */
export const GATE_UNAVAILABLE_MESSAGE =
  "Couldn't check your access to this trip just now. Nothing is lost — try again in a moment.";

/**
 * Is this error the membership gate saying NO — the one answer that may tell
 * someone they are off a trip?
 *
 * Both halves, deliberately: the tRPC code AND the exact message. FORBIDDEN
 * alone is also what a role check says to a member who IS on the trip ("only
 * an organizer can…"), and the message alone could be matched by an error that
 * merely quotes it. A gate that could not run is a 500 with
 * `GATE_UNAVAILABLE_MESSAGE` and never matches.
 */
export function isNotAMemberError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { message?: unknown; data?: { code?: unknown } | null };
  return e.data?.code === "FORBIDDEN" && e.message === NOT_A_MEMBER_MESSAGE;
}
