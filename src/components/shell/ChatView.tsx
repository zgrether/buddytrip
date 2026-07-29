"use client";

import { useState, type CSSProperties } from "react";
import { MessageCircle, ClipboardList, Newspaper } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, useNewsUnreadCount, type NewsAuthorMeta } from "@/components/NewsPanel";
import { ChatNotifyToggle } from "@/components/ChatNotifyToggle";
import { useTripRole } from "@/hooks/useTripRole";
import { useIsChatColumn } from "./breakpoints";
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
 * fills whatever height THIS component gives it, and inline (see `rootStyle`
 * below) that's a `position: fixed` box with `top`/`bottom` pinned to the
 * viewport rather than a calculated height — load-bearing, not decorative.
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
    // "Organizers" is the established term for this channel everywhere else
    // (FloatingChatPanel's own internal tabs, the glossary) — `planning` is
    // only the code-identifier/DB-value; the display string was never meant
    // to change.
    planning: { label: "Organizers", Icon: ClipboardList, unread: planningUnread },
    news: { label: "News", Icon: Newspaper, unread: newsUnread },
  };

  // Aside (≥1280): a BOUNDED box, `height: 100%` of the shell's chat column.
  //
  // This used to be `minHeight: calc(100svh - 56px - …)` — a FLOOR — on the
  // assumption that the grid's `items-stretch` would grow it to match the content
  // beside it. It didn't, because the grid had no bounded height either: the whole
  // shell was `min-h-screen`, a floor all the way up. So the `flex-1 min-h-0`
  // message list below had nothing to clip against, the history ran off screen and
  // the composer drifted with total content height — the same failure this
  // component's INLINE branch was rewritten to fix, never applied to desktop.
  // AppShell is now a bounded `lg:h-dvh` column, so `100%` resolves and the
  // existing flex model does the rest, unchanged.
  //
  // Inline (mobile, or desktop <1280 where Chat OWNS the tab): NO CALCULATED
  // SIZE — that was two fixes in a row that each turned out incomplete
  // (dvh, then svh) because ANY `height`/`min-height` built from a viewport
  // unit is a SNAPSHOT the browser doesn't keep honest as its dynamic
  // toolbar shows/hides on scroll (Chrome's address bar collapsing mid-scroll
  // is exactly what broke it live, even after the dvh->svh fix). The
  // overlay/non-embedded panel never had ANY of these bugs, for exactly this
  // reason: its chrome is `position: fixed; top-14; bottom-0` — both EDGES
  // pinned to the viewport, height left for the browser to resolve natively,
  // which it keeps correct through toolbar changes with zero JS/CSS math on
  // our end. This is that same technique, applied to the whole embedded
  // surface (segment row included) rather than each panel independently —
  // independently-fixed panels is the ORIGINAL bug this embedded mode
  // replaced (each one covered ChatView's own segment switcher; see #733).
  // One fixed box, top/bottom pinned, flexbox does the rest exactly as it
  // already did — `flex-1 min-h-0` on the panel wrapper below still clips
  // and scrolls correctly, now against a height the browser computes instead
  // of one we calculated.
  const chatIsColumn = useIsChatColumn();
  const rootStyle: CSSProperties = chatIsColumn
    ? { height: "100%", minHeight: 0 }
    : {
        position: "fixed",
        top: 56, // below the sticky 56px top nav (TopNav's own h-14)
        bottom: "var(--bt-bottomnav-height, 0px)", // above the mobile bottom tab bar
        left: 0,
        right: 0,
        zIndex: 20, // below TopNav/AppTabBar's z-40, above ordinary page content
        background: "var(--color-bt-base)",
      };

  return (
    <div data-testid="chat-view" className="flex flex-col" style={rootStyle}>
      {/* Segment switch — contextual page structure, not chrome, so it blends
          with the page background per STYLE_GUIDE §1. Notify toggle sits
          inline at the end of this row (a real per-account preference, not a
          dismiss affordance, so it stays regardless of which segment is
          active) rather than in its own separate row. */}
      <div className="flex flex-shrink-0 items-center gap-1 px-4 pt-3 pb-3" role="tablist">
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
        <div className="ml-auto flex-shrink-0">
          <ChatNotifyToggle />
        </div>
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
