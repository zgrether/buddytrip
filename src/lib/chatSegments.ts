/**
 * Chat tab segment visibility — pure, client-safe so it can be unit-tested
 * without mounting the trpc-wired `ChatView` component (the codebase's usual
 * split for this kind of derived-state logic; see `strokePlay.ts`).
 */

export type ChatSegment = "crew" | "planning" | "news";

export type TripRoleValue = "Owner" | "Organizer" | "Member" | null | undefined;

export const DEFAULT_CHAT_SEGMENT: ChatSegment = "crew";

/** sessionStorage key for the last-picked segment (per-session, not per-account). */
export const CHAT_SEGMENT_KEY = "bt.chatSegment.v1";

/** Narrow an unknown stored value back to a segment; anything else → the default. */
export function parseChatSegment(v: string | null): ChatSegment {
  return v === "crew" || v === "planning" || v === "news" ? v : DEFAULT_CHAT_SEGMENT;
}

/**
 * Planning is visible only when the trip has at least one designated
 * Organizer AND the current viewer is that trip's Owner or an Organizer.
 *
 * The "organizers designated" half matters independently of role: a lone
 * Owner with no one promoted has nobody to plan away from the crew with, so
 * the segment would just be an empty room — it stays hidden even for them
 * until an Organizer exists.
 *
 * "Designated" means actually in — `status === "in"`, matching
 * FloatingChatPanel's own organizers-roster filter. A member merely
 * `invited` with role Organizer hasn't accepted yet, so they aren't really
 * on the trip to plan with; counting them would show Planning to the Owner
 * for an Organizer seat nobody's actually filled.
 */
export function canSeePlanningSegment(
  myRole: TripRoleValue,
  members: { role: TripRoleValue; status?: string }[]
): boolean {
  const hasOrganizers = members.some((m) => m.role === "Organizer" && m.status === "in");
  return hasOrganizers && (myRole === "Owner" || myRole === "Organizer");
}

/** Segments to render, in order, for the current viewer. */
export function visibleChatSegments(canSeePlanning: boolean): ChatSegment[] {
  return canSeePlanning ? ["crew", "planning", "news"] : ["crew", "news"];
}

/**
 * Falls back to the default segment if the previously-selected one is no
 * longer visible (e.g. Planning access was revoked mid-session by a
 * demotion, or the last Organizer was removed). Without this the segment
 * bar would keep highlighting a tab whose content the panel now refuses.
 */
export function resolveActiveChatSegment(
  selected: ChatSegment,
  canSeePlanning: boolean
): ChatSegment {
  return selected === "planning" && !canSeePlanning ? DEFAULT_CHAT_SEGMENT : selected;
}
