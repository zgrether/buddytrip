"use client";

import { useState } from "react";
import { MessageCircle, ClipboardList, Newspaper } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, useNewsUnreadCount, type NewsAuthorMeta } from "@/components/NewsPanel";
import { useTripRole } from "@/hooks/useTripRole";
import {
  DEFAULT_CHAT_SEGMENT,
  canSeePlanningSegment,
  visibleChatSegments,
  resolveActiveChatSegment,
  type ChatSegment,
} from "@/lib/chatSegments";

/**
 * ChatView — the Chat tab (Phase 3), and the persistent ≥1280 side column.
 *
 * News folds in here as a THIRD SEGMENT rather than staying a separate rail:
 * all three are "things the crew said", they were already mutually exclusive
 * (opening one closed the other), and the four-tab bar has no room for a
 * fifth entry. The segmented control is the switch.
 *
 * Both `FloatingChatPanel` and `NewsPanel` render through their `embedded`
 * branch here — normal flow, no scrim, no drag-resize, no close × (a tab has
 * nothing to close; you leave by choosing another segment). That branch
 * fills whatever height THIS component gives it, so the height math below is
 * load-bearing, not decorative.
 */
export function ChatView({ tripId, canPost }: { tripId: string; canPost: boolean }) {
  const { role } = useTripRole(tripId);

  // Crew names for authorship, and the roster `canSeePlanningSegment` checks
  // for a designated Organizer. STRUCTURE_QUERY — this is slow-changing
  // roster data, and the Cup tab already holds the same key, so on a warm
  // shell it costs nothing.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId }, STRUCTURE_QUERY);

  const typedMembers = members as {
    user_id: string | null;
    memberId: string;
    displayName: string;
    role: "Owner" | "Organizer" | "Member";
    status?: string;
    user: { avatar_icon: string | null } | null;
  }[];

  /**
   * PLANNING IS CONDITIONAL. It only appears when the trip has a designated
   * Organizer AND the current viewer is that trip's Owner or an Organizer —
   * most crew, and even a lone Owner with nobody promoted, see Crew · News.
   *
   * Derived live, not read once: `role` comes from `useTripRole`, and
   * `members` from `tripMembers.list`, both invalidated by
   * `useRealtimeMembers` on every `trip_members` change — so a newly
   * designated organizer gets the segment WITHOUT a remount, and a demoted
   * one loses it immediately. A mount-time read would have left them staring
   * at the wrong set of segments until they navigated away and back, the
   * same propagation gap the captain grant had.
   */
  const canSeePlanning = canSeePlanningSegment(role, typedMembers);
  const segments = visibleChatSegments(canSeePlanning);

  const [selected, setSelected] = useState<ChatSegment>(DEFAULT_CHAT_SEGMENT);
  // If the role (or the last organizer) flips away while Planning is
  // selected, fall back to Crew during render — the panel refuses the
  // channel anyway, so without this the segment bar would highlight a tab
  // showing someone else's content.
  const activeSegment = resolveActiveChatSegment(selected, canSeePlanning);

  // Per-segment unread — Crew/Planning from one server-computed breakdown
  // (messages.unreadCountByChannel; `planning` comes back 0 for a caller who
  // can't see it), News from its own procedure. No subscription mounted HERE
  // — AppShell holds the one always-mounted chat realtime subscription for
  // the whole scoped session, which invalidates this query too (both read
  // messages.unreadCount/unreadCountByChannel's cache). News stays on its
  // v1 posture (refetch-on-focus / default staleTime — see news.unreadCount);
  // chat doesn't, because a chat badge that visibly trails live messages
  // reads as broken in a way a quiet news badge doesn't.
  const { data: chatUnread } = trpc.messages.unreadCountByChannel.useQuery(
    { tripId },
    { enabled: !!tripId }
  );
  const newsUnread = useNewsUnreadCount(tripId);
  const crewUnread = chatUnread?.crew ?? 0;
  const planningUnread = canSeePlanning ? (chatUnread?.planning ?? 0) : 0;

  const memberNames = Object.fromEntries(
    typedMembers.map((m) => [m.user_id ?? m.memberId, m.displayName])
  );
  const authors = Object.fromEntries(
    typedMembers.map((m) => [
      m.user_id ?? m.memberId,
      { name: m.displayName, role: m.role, avatarIcon: m.user?.avatar_icon ?? null } satisfies NewsAuthorMeta,
    ])
  );

  const SEGMENT_META: Record<ChatSegment, { label: string; Icon: typeof MessageCircle; unread: number }> = {
    crew: { label: "Crew", Icon: MessageCircle, unread: crewUnread },
    planning: { label: "Planning", Icon: ClipboardList, unread: planningUnread },
    news: { label: "News", Icon: Newspaper, unread: newsUnread },
  };

  return (
    // Fills at least the visible viewport below the 56px top bar and above
    // the bottom tab bar (0 on desktop, where AppTabBar doesn't mount) — the
    // same box whether this instance OWNS the tab (mobile / <1280 desktop)
    // or sits in the persistent ≥1280 side column, where grid `items-stretch`
    // lets it grow past the floor to match the Trip/Cup content beside it.
    <div
      data-testid="chat-view"
      className="flex flex-col"
      style={{ minHeight: "calc(100dvh - 56px - var(--bt-bottomnav-height, 0px))" }}
    >
      {/* Segment switch — contextual page structure, not chrome, so it blends
          with the page background per STYLE_GUIDE §1. */}
      <div className="flex flex-shrink-0 gap-1 px-4 pt-3" role="tablist">
        {segments.map((id) => {
          const { label, Icon, unread } = SEGMENT_META[id];
          const selectedTab = activeSegment === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selectedTab}
              onClick={() => setSelected(id)}
              data-testid={`chat-stream-${id}`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
              style={{
                background: selectedTab ? "var(--color-bt-card-raised)" : "transparent",
                color: selectedTab ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
              }}
            >
              <Icon size={14} />
              {label}
              {unread > 0 && (
                <span
                  data-testid={`chat-stream-${id}-badge`}
                  className="inline-flex items-center justify-center rounded-full"
                  style={{
                    minWidth: 15,
                    height: 15,
                    padding: "0 4px",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    lineHeight: "15px",
                    background: id === "news" ? "var(--color-bt-accent)" : "var(--color-bt-owner)",
                    color: "#0d1f1a",
                  }}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Crew and Planning are the SAME panel on different channels — this
          view drives it via `channel`, so the panel hides its own tabs.
          Mounted separately (not one panel with a swapped prop) so each
          keeps its own scroll position and unsent draft. `flex-1 min-h-0`
          gives each embedded panel the rest of this column's height. */}
      <div className="flex min-h-0 flex-1 flex-col" hidden={activeSegment !== "crew"}>
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
        <div className="flex min-h-0 flex-1 flex-col" hidden={activeSegment !== "planning"}>
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
      <div className="flex min-h-0 flex-1 flex-col" hidden={activeSegment !== "news"}>
        <NewsPanel tripId={tripId} isOpen embedded onClose={noop} canPost={canPost} authors={authors} />
      </div>
    </div>
  );
}

/** A tab has no dismiss — see the header. */
function noop() {}
