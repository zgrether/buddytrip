/**
 * Chat tab segment visibility — pure, client-safe so it can be unit-tested
 * without mounting the trpc-wired `ChatView` component (the codebase's usual
 * split for this kind of derived-state logic; see `strokePlay.ts`).
 */

export type ChatSegment = "crew" | "team" | "planning" | "news";

/**
 * What the current viewer is allowed to see, as ONE value.
 *
 * An options object rather than two positional booleans, deliberately:
 * `visibleChatSegments(true, false)` and `visibleChatSegments(false, true)`
 * are both valid calls that a reader cannot tell apart, and the two flags are
 * exactly the kind of pair CLAUDE.md #13 records drifting when they must always
 * be passed together.
 */
export interface ChatSegmentAccess {
  /** Owner/Organizer of a trip that HAS a designated Organizer. */
  canSeePlanning: boolean;
  /**
   * The viewer is on a team in this trip's competition.
   *
   * Not a permission so much as an existence fact: someone on no team has no
   * team room to open, so the tab does not exist for them rather than
   * appearing and refusing.
   */
  hasTeam: boolean;
}

export type TripRoleValue = "Owner" | "Organizer" | "Member" | null | undefined;

export const DEFAULT_CHAT_SEGMENT: ChatSegment = "crew";

/** sessionStorage key for the last-picked segment (per-session, not per-account). */
export const CHAT_SEGMENT_KEY = "bt.chatSegment.v1";

/** Narrow an unknown stored value back to a segment; anything else → the default. */
export function parseChatSegment(v: string | null): ChatSegment {
  return v === "crew" || v === "team" || v === "planning" || v === "news"
    ? v
    : DEFAULT_CHAT_SEGMENT;
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

/**
 * Segments to render, in order, for the current viewer.
 *
 * Order is Crew · Team · Organizers · News. Team sits second because it is the
 * other room a person TALKS in — Organizers and News are both staff-authored
 * surfaces, and putting Team next to Crew keeps the two conversational rooms
 * adjacent.
 */
export function visibleChatSegments(access: ChatSegmentAccess): ChatSegment[] {
  const out: ChatSegment[] = ["crew"];
  if (access.hasTeam) out.push("team");
  if (access.canSeePlanning) out.push("planning");
  out.push("news");
  return out;
}

/**
 * Falls back to the default segment if the previously-selected one is no
 * longer visible (e.g. Planning access was revoked mid-session by a
 * demotion, or the last Organizer was removed). Without this the segment
 * bar would keep highlighting a tab whose content the panel now refuses.
 *
 * Team needs this for a reason Planning does not: the segment is remembered
 * for the SESSION and chat is a trip-scoped overlay, so someone who opens chat
 * on a trip where they have no team would otherwise land on a Team tab that is
 * not in the bar — and being removed from a team mid-session does the same
 * thing. Both are ordinary, and both used to be unreachable states.
 */
export function resolveActiveChatSegment(
  selected: ChatSegment,
  access: ChatSegmentAccess
): ChatSegment {
  if (selected === "planning" && !access.canSeePlanning) return DEFAULT_CHAT_SEGMENT;
  if (selected === "team" && !access.hasTeam) return DEFAULT_CHAT_SEGMENT;
  return selected;
}
