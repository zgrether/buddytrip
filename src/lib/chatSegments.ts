// ── Chat tab segment derivation — pure, no React/tRPC deps ─────────────────
//
// Shared by ChatView (renders the segments) and AppShell (badges the Chat
// nav tab), so "which segments are visible" and "what counts toward the tab
// badge" can't drift into two different answers. Unit-testable without
// mounting a component — this codebase's tests exercise logic, not the DOM.

export type ChatSegmentId = "crew" | "planning" | "news";

export const DEFAULT_CHAT_SEGMENT: ChatSegmentId = "crew";

/** The subset of a tripMembers.list row this module needs. */
export interface MemberRoleStatus {
  role: string;
  status: string;
}

/**
 * "Organizers are designated on the trip" — at least one member (besides the
 * always-present Owner) holds the Organizer role and is actually in
 * (status "in", not merely invited/maybe/out). Every trip has an Owner, so
 * checking the viewer's own role alone can't distinguish "nobody has been
 * promoted yet" from "an Organizer exists" — this does.
 */
export function hasDesignatedOrganizers(members: MemberRoleStatus[]): boolean {
  return members.some((m) => m.role === "Organizer" && m.status === "in");
}

/**
 * Planning is visible only when organizers exist on the trip AND the viewer
 * is currently Owner/Organizer. Both conditions are live inputs (role can
 * change via realtime-invalidated tripMembers.list; organizer designation
 * changes the same way) — this is a pure function of their current values,
 * not a snapshot taken once.
 */
export function canSeePlanningSegment(canEdit: boolean, hasOrganizers: boolean): boolean {
  return canEdit && hasOrganizers;
}

/** Ordered segment list for the tab strip. */
export function visibleChatSegments(canSeePlanning: boolean): ChatSegmentId[] {
  return canSeePlanning ? ["crew", "planning", "news"] : ["crew", "news"];
}

/**
 * The segment actually shown. Falls back to Crew if the previously-selected
 * segment is Planning but the viewer can no longer see it (demoted, or the
 * last Organizer was demoted) — never highlights a tab whose content the
 * panel would refuse to show.
 */
export function resolveActiveSegment(
  selected: ChatSegmentId,
  canSeePlanning: boolean,
): ChatSegmentId {
  return selected === "planning" && !canSeePlanning ? DEFAULT_CHAT_SEGMENT : selected;
}

export interface ChatUnreadCounts {
  crew: number;
  planning: number;
  news: number;
}

/**
 * Tab-level badge total — sums only segments the viewer can currently see.
 * Planning's count is server-filtered to 0 for non-organizers already
 * (messages.unreadCounts), but a trip with no designated organizers can still
 * report a nonzero `planning` figure for an Owner/Organizer whose segment is
 * hidden by `hasDesignatedOrganizers` alone — this excludes it either way, so
 * the badge never counts a segment the tab strip doesn't render.
 */
export function chatTabUnreadTotal(counts: ChatUnreadCounts, canSeePlanning: boolean): number {
  return counts.crew + (canSeePlanning ? counts.planning : 0) + counts.news;
}
