/**
 * Chat tab segment visibility — pure, client-safe so it can be unit-tested
 * without mounting the trpc-wired `ChatView` component (the codebase's usual
 * split for this kind of derived-state logic; see `strokePlay.ts`).
 */

export type ChatSegment = "crew" | "planning" | "news";

export type TripRoleValue = "Owner" | "Organizer" | "Member" | null | undefined;

export const DEFAULT_CHAT_SEGMENT: ChatSegment = "crew";

/**
 * Planning is visible only when the trip has at least one designated
 * Organizer AND the current viewer is that trip's Owner or an Organizer.
 *
 * The "organizers designated" half matters independently of role: a lone
 * Owner with no one promoted has nobody to plan away from the crew with, so
 * the segment would just be an empty room — it stays hidden even for them
 * until an Organizer exists.
 */
export function canSeePlanningSegment(
  myRole: TripRoleValue,
  members: { role: TripRoleValue }[]
): boolean {
  const hasOrganizers = members.some((m) => m.role === "Organizer");
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
