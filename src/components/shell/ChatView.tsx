"use client";

import { useState } from "react";
import { MessageCircle, ClipboardList, Newspaper } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { FloatingChatPanel, useChatUnreadCounts } from "@/components/FloatingChatPanel";
import { NewsPanel, useNewsUnreadCount, type NewsAuthorMeta } from "@/components/NewsPanel";
import { useTripRole } from "@/hooks/useTripRole";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import {
  DEFAULT_CHAT_SEGMENT,
  canSeePlanningSegment,
  chatTabUnreadTotal,
  hasDesignatedOrganizers,
  resolveActiveSegment,
  visibleChatSegments,
  type ChatSegmentId,
} from "@/lib/chatSegments";

/**
 * ChatView — the Chat tab (Phase 3).
 *
 * News folds in here as a SECOND STREAM rather than staying a separate rail: both
 * are "things the crew said", they were already mutually exclusive (opening one
 * closed the other), and the four-tab bar has no room for a fifth entry. The
 * segmented control is the switch.
 *
 * Both panels are existing components rendered with `isOpen` pinned true — they
 * already know how to lay themselves out; this just stops them being overlays.
 * `onClose` is a no-op because a tab cannot be dismissed: you leave by choosing
 * another tab, and the panels' own close affordances are removed in embedded mode
 * (see FloatingChatPanel/NewsPanel) rather than wired to it.
 */
export type Stream = ChatSegmentId;

const SEGMENT_META: Record<ChatSegmentId, { label: string; Icon: typeof MessageCircle }> = {
  crew: { label: "Crew", Icon: MessageCircle },
  planning: { label: "Planning", Icon: ClipboardList },
  news: { label: "News", Icon: Newspaper },
};

export function ChatView({ tripId, canPost }: { tripId: string; canPost: boolean }) {
  /**
   * Three segments: Crew · Planning · News, defaulting to Crew.
   *
   * PLANNING IS CONDITIONAL on TWO live inputs, both derived every render —
   * never a mount-time snapshot:
   *   1. organizers are actually designated on the trip (hasDesignatedOrganizers
   *      over tripMembers.list — every trip has an Owner, so checking the
   *      viewer's own role alone can't tell "nobody's been promoted yet" from
   *      "an Organizer exists")
   *   2. the viewer is currently Owner/Organizer (useTripRole)
   * Both `tripMembers.list` and the role it derives from are invalidated by
   * useRealtimeMembers on every trip_members change, so a promotion/demotion
   * (of the viewer OR of whoever holds the trip's only Organizer seat) updates
   * this WITHOUT a remount.
   *
   * If the role flips away while Planning is selected, the selection falls back
   * to Crew during render — the panel refuses the channel anyway, so without this
   * the segment bar would highlight a tab showing someone else's content.
   */
  const { canEdit } = useTripRole(tripId);
  const [stream, setStream] = useState<ChatSegmentId>(DEFAULT_CHAT_SEGMENT);

  // Crew names for authorship. STRUCTURE_QUERY — this is slow-changing roster
  // data, and the Cup tab already holds the same key, so on a warm shell it costs
  // nothing.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId }, STRUCTURE_QUERY);

  const hasOrganizers = hasDesignatedOrganizers(members as { role: string; status: string }[]);
  const canSeePlanning = canSeePlanningSegment(canEdit, hasOrganizers);
  const segments = visibleChatSegments(canSeePlanning);
  const activeStream = resolveActiveSegment(stream, canSeePlanning);

  // Per-segment unread — server-filtered (messages.unreadCounts already
  // returns 0 for planning when the caller isn't Owner/Organizer; nothing
  // here re-derives visibility client-side).
  const { crew: crewUnread, planning: planningUnread } = useChatUnreadCounts(tripId);
  const newsUnread = useNewsUnreadCount(tripId);
  const unreadFor: Record<ChatSegmentId, number> = {
    crew: crewUnread,
    planning: planningUnread,
    news: newsUnread,
  };

  const memberNames = Object.fromEntries(
    (members as { user_id: string | null; memberId: string; displayName: string }[]).map((m) => [
      m.user_id ?? m.memberId,
      m.displayName,
    ]),
  );
  const authors = Object.fromEntries(
    (
      members as {
        user_id: string | null;
        memberId: string;
        displayName: string;
        role: NewsAuthorMeta["role"];
        user: { avatar_icon: string | null } | null;
      }[]
    ).map((m) => [
      m.user_id ?? m.memberId,
      { name: m.displayName, role: m.role, avatarIcon: m.user?.avatar_icon ?? null },
    ]),
  );

  return (
    <div data-testid="chat-view">
      {/* Stream switch — contextual page structure, not chrome, so it blends with
          the page background per STYLE_GUIDE §1. */}
      <div className="flex gap-1 px-4 pt-3" role="tablist">
        {segments.map((id) => {
          const { label, Icon } = SEGMENT_META[id];
          const selected = activeStream === id;
          const unread = unreadFor[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setStream(id)}
              data-testid={`chat-stream-${id}`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
              style={{
                background: selected ? "var(--color-bt-card-raised)" : "transparent",
                color: selected ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
              }}
            >
              <Icon size={14} />
              {label}
              {unread > 0 && (
                <span
                  data-testid={`chat-stream-${id}-unread`}
                  className="inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Crew and Planning are the SAME panel on different channels — the
          shell's segments drive it via `channel`, so the panel hides its own
          tabs. Mounted separately (not one panel with a swapped prop) so each
          keeps its own scroll position and unsent draft. */}
      <div hidden={activeStream !== "crew"}>
        <FloatingChatPanel
          tripId={tripId}
          isOpen
          embedded
          channel="crew"
          onClose={noop}
          memberNames={memberNames}
        />
      </div>
      {canSeePlanning && (
        <div hidden={activeStream !== "planning"}>
          <FloatingChatPanel
            tripId={tripId}
            isOpen
            embedded
            channel="planning"
            onClose={noop}
            memberNames={memberNames}
          />
        </div>
      )}
      <div hidden={activeStream !== "news"}>
        <NewsPanel tripId={tripId} isOpen embedded onClose={noop} canPost={canPost} authors={authors} />
      </div>
    </div>
  );
}

/** A tab has no dismiss — see the header. */
function noop() {}

/**
 * useChatTabUnread — the Chat NAV tab's badge total (AppTabBar/DesktopTabStrip),
 * not a segment's own count. Reuses the exact same visibility derivation as the
 * segments themselves (hasDesignatedOrganizers + canSeePlanningSegment) so the
 * tab badge and the segment set can't disagree about what's visible — a member's
 * badge excludes Planning's count even if it happens to be nonzero server-side.
 *
 * Called from AppShell, which is mounted for the whole scoped trip session
 * (every tab, not just Chat) — so this is now the ONE always-mounted holder of
 * the chat realtime subscription that useChatUnreadCount used to be when the
 * old TopNav Chat button lived on this page. ChatView's own per-segment
 * useChatUnreadCounts call does NOT also subscribe (would collide on the same
 * channel topic); it relies on this hook's subscription for live updates,
 * exactly as an open FloatingChatPanel always has.
 */
export function useChatTabUnread(tripId: string | null): number {
  useRealtimeChat(tripId ?? "", "trip");

  const { canEdit } = useTripRole(tripId ?? undefined);
  const { data: members = [] } = trpc.tripMembers.list.useQuery(
    { tripId: tripId ?? "" },
    { ...STRUCTURE_QUERY, enabled: !!tripId }
  );
  const hasOrganizers = hasDesignatedOrganizers(members as { role: string; status: string }[]);
  const canSeePlanning = canSeePlanningSegment(canEdit, hasOrganizers);

  const { crew, planning } = useChatUnreadCounts(tripId ?? "");
  const news = useNewsUnreadCount(tripId ?? "");

  return chatTabUnreadTotal({ crew, planning, news }, canSeePlanning);
}
