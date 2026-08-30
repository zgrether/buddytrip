"use client";

import { useState } from "react";
import { MessageCircle, ClipboardList, Newspaper, Shield } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, useNewsUnreadCount, type NewsAuthorMeta } from "@/components/NewsPanel";
import { useTripRole } from "@/hooks/useTripRole";
import {
  DEFAULT_CHAT_SEGMENT,
  CHAT_SEGMENT_KEY,
  parseChatSegment,
  canSeePlanningSegment,
  visibleChatSegments,
  resolveActiveChatSegment,
  type ChatSegment,
} from "@/lib/chatSegments";
import { readChatTextSize, writeChatTextSize, type ChatTextSize } from "@/lib/chatTextSize";

/**
 * ChatView — the Crew/Organizers/News segmented content (Phase 6: the
 * CONTENT, not the container). It used to also own its own placement — a
 * fixed inline box below the top nav on mobile, a bounded aside box at
 * ≥1280 — because it WAS the container: Chat was a tab, mounted directly by
 * `AppShell` in place of whichever view was selected.
 *
 * Chat is an overlay now, never a view (see `useAppView`'s doc comment), so
 * something else owns placement: `ChatSheet` (the resizable bottom sheet,
 * <1280) or the plain `<aside>` `AppShell` already renders (≥1280, unchanged
 * from before). This component just fills whatever height IT is given — no
 * `position: fixed`, no breakpoint read of its own. That is the whole "this
 * spec changes the container, not the contents" instruction: everything
 * below (segments, the two embedded `FloatingChatPanel`s, `NewsPanel`,
 * auto-scroll, unread) is unchanged.
 *
 * News folds in here as a THIRD SEGMENT rather than staying a separate rail:
 * all three are "things the crew said", they were already mutually exclusive
 * (opening one closed the other), and the tab bar has no room for a
 * fifth entry. The segmented control is the switch.
 *
 * `FloatingChatPanel` and `NewsPanel` both always render in normal flow now —
 * no scrim, no drag-resize, no close × (this component has nothing to close;
 * the container around it owns that). Their standalone chrome (#758) is gone,
 * since the only caller of either was this same segment. Whatever's rendered
 * fills whatever height THIS component gives it.
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

  /**
   * The viewer's team, and the ONLY thing that decides whether a Team tab
   * exists. Null for someone on no team, and for a trip with no competition —
   * both ordinary, and both mean the tab does not render rather than rendering
   * and refusing.
   *
   * `competitions.myTeamColor` rather than a new query: it already answers this
   * under the same one-competition-per-trip rule the server's
   * `viewerTeamForTrip` uses (they share that function), and React Query dedupes
   * it with the app-bar avatar's copy, so on a warm shell the Team tab costs no
   * request. It also means the tab's colour and the avatar's cannot disagree.
   */
  const { data: myTeam } = trpc.competitions.myTeamColor.useQuery(
    { tripId },
    { ...STRUCTURE_QUERY, enabled: !!tripId }
  );
  const hasTeam = !!myTeam;

  const segmentAccess = { canSeePlanning, hasTeam };
  const segments = visibleChatSegments(segmentAccess);

  // Remembered for the SESSION. Chat opens as an overlay and closes back to the
  // tab beneath it (#756), so an organizer working out of the Organizers channel
  // was thrown back to Crew on every single open. sessionStorage rather than
  // localStorage deliberately — "where I was a minute ago" is the useful memory;
  // "where I was last month" is a surprise. Lazy initializer so it reads once,
  // and SSR-safe (no `window` during render on the server).
  const [selected, setSelected] = useState<ChatSegment>(() => {
    if (typeof window === "undefined") return DEFAULT_CHAT_SEGMENT;
    try {
      return parseChatSegment(window.sessionStorage.getItem(CHAT_SEGMENT_KEY));
    } catch {
      return DEFAULT_CHAT_SEGMENT;
    }
  });
  const pickSegment = (id: ChatSegment) => {
    setSelected(id);
    try {
      window.sessionStorage.setItem(CHAT_SEGMENT_KEY, id);
    } catch {
      // Private mode / storage disabled — the choice just doesn't persist.
    }
  };
  // If the role (or the last organizer) flips away while Planning is
  // selected, fall back to Crew during render — the panel refuses the
  // channel anyway, so without this the segment bar would highlight a tab
  // showing someone else's content.
  const activeSegment = resolveActiveChatSegment(selected, segmentAccess);

  // The reading text-size preference (S/M/L, `chatTextSize.ts`) — LIFTED here
  // rather than owned by each `FloatingChatPanel`, because this component
  // mounts BOTH Crew and Organizers panels simultaneously (one hidden via
  // CSS below, not unmounted — same reason `selected`/`activeSegment` exist
  // instead of two independent panel-local states). If each panel read its
  // own localStorage copy, changing the size while looking at one channel
  // wouldn't reach the other until it remounted. One value, passed to both,
  // means a change is instant and never has to wait for a remount.
  const [textSize, setTextSizeState] = useState<ChatTextSize>(() => readChatTextSize());
  const setTextSize = (size: ChatTextSize) => {
    setTextSizeState(size);
    writeChatTextSize(size);
  };

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
  // Same posture as planning's: the server already returns 0 for a caller with
  // no team, and this second guard keeps a stale cache from painting a badge on
  // a tab that is no longer rendered.
  const teamUnread = hasTeam ? (chatUnread?.team ?? 0) : 0;

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
    // "Team", not the team's NAME. The name is on the header inside the panel
    // where it has room; a tab reading "Banks" would put a proper noun in a row
    // of common ones and stop looking like a channel.
    team: { label: "Team", Icon: Shield, unread: teamUnread },
    // "Organizers" is the established term for this channel everywhere else
    // (FloatingChatPanel's own internal tabs, the glossary) — `planning` is
    // only the code-identifier/DB-value; the display string was never meant
    // to change.
    //
    // It is NOT shortened to "Orgs" to make a fourth tab fit. That is the drift
    // that produced Void/Cancelled and Total Points/Game Points, and the bar is
    // the thing that gives — see the tab row's own note on how four fit.
    planning: { label: "Organizers", Icon: ClipboardList, unread: planningUnread },
    news: { label: "News", Icon: Newspaper, unread: newsUnread },
  };

  // Fills whatever box the container gives it — `height: 100%, min-height: 0`
  // — full stop. Both containers already give this a DEFINITE height:
  // `AppShell`'s `<aside>` (≥1280, unchanged) and `ChatSheet` (<1280, a
  // `position: fixed` box whose own height is either a drag-set pixel value
  // or a snap-point percentage — never a viewport-unit calculation done HERE,
  // which is exactly the class of bug (dvh, then svh, both wrong under
  // Chrome's collapsing address bar) the old inline branch existed to avoid.
  // The container now owns that; this component just trusts it.
  return (
    <div data-testid="chat-view" className="flex h-full min-h-0 flex-col">
      {/* Segment switch — contextual page structure, not chrome, so it blends
          with the page background per STYLE_GUIDE §1. Notify toggle sits
          inline at the end of this row (a real per-account preference, not a
          dismiss affordance, so it stays regardless of which segment is
          active) rather than in its own separate row.

          `pt-3` was `pt-1` before the reported "~60px of nothing between the
          grabber and the tabs" — the breakdown, measured against the actual
          markup rather than guessed:

            44px  ChatSheet's grip box (`h-11`) — the 44px TOUCH TARGET a
                  platform guideline requires and #1046 already fixed once;
                  the visual pill is 4px, the rest of the 44 is intentional
                  hit-area padding, not slack. NOT reduced here.
            12px  this row's own `pt-3`, on TOP of the grip
             4px  the tab button's own `pt-1`, before its content starts
            ----
            60px  total before a tab's content begins — the number reported

          Of that, only the middle 12px had no functional backing (the grip's
          44 is protected; the button's own 4px is its own tap-cushion, left
          alone). Cut to `pt-1` (4px), recovering 8px. This wrapper is shared
          with the ≥1280 `<aside>` layout, which has NO grip and therefore no
          equivalent complaint — trimming its top padding too is a deliberate
          side effect, not a miss: `AppShell`'s aside adds no padding of its
          own around `ChatView` (`{chat}` fills it directly), so this is
          already the ONLY top gap there, and forking it per-container would
          mean two implementations of one tab row for a few pixels neither
          side asked to keep. */}
      {/* FITTING FOUR. Team makes this a four-tab row. Measured on the rendered
          row at a 375px viewport (scrollWidth vs clientWidth, client = 373):

            old padding, no badge    373 / 373   fits, with ZERO slack
            old padding, one badge   376 / 373   OVERFLOWS
            shipped padding, badge   373 / 373   fits (content ends at 322)

          The interesting number is the first one. The old `px-4` container +
          `px-3` buttons + `gap-1` fit four tabs EXACTLY, so any unread badge
          tipped it over — and a two-digit or "99+" badge more so. A row that
          fits until someone gets a message is not a row that fits.

          "Organizers" is a ratified term (glossary, NOTIFICATIONS.md, this
          file's own note below) so shortening it to "Orgs" was not on the table;
          that is the drift that produced Void/Cancelled. The BAR gives instead —
          container `px-3`, buttons `px-2`, `gap-0.5`, which leaves 51px of slack
          with a badge showing.

          Applied at every segment count rather than only at four, deliberately.
          A count-conditional padding would be two tab rows in one, and this
          file's neighbouring comment already refuses that trade for the same
          reason ("two implementations of one tab row for a few pixels neither
          side asked to keep"). At two or three tabs the change is a few pixels
          of breathing room, which nobody asked to keep either. */}
      <div className="flex flex-shrink-0 items-center gap-0.5 px-3 pt-1 pb-3" role="tablist">
        {segments.map((id) => {
          const { label, Icon, unread } = SEGMENT_META[id];
          const selectedTab = activeSegment === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selectedTab}
              onClick={() => pickSegment(id)}
              data-testid={`chat-stream-${id}`}
              className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[12.5px] font-semibold transition-colors"
              style={{
                // TABS, drawn as tabs. These were `rounded-lg` with a
                // `card-raised` fill when selected, which is the same rounded
                // filled shape as the message bubbles immediately below them —
                // so the control read as another message rather than a control.
                // STYLE_GUIDE §5 gives tabs radius `None`; this is the same
                // treatment `TopNav`'s Trip/Cup tabs already use — transparent
                // ground, 2px accent underline, accent text — so the app has one
                // way of showing a selected tab instead of two. No extra weight.
                background: "transparent",
                border: 0,
                borderBottom: `2px solid ${selectedTab ? "var(--color-bt-accent)" : "transparent"}`,
                color: selectedTab ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
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
          // `hidden` on the wrapper is CSS; the panel is still mounted and its
          // effects still run. `active` is what tells it whether anyone is
          // actually looking — see the prop's note.
          active={activeSegment === "crew"}
          channel="crew"
          memberNames={memberNames}
          textSize={textSize}
          onChangeTextSize={setTextSize}
        />
      </div>
      {/* Team is a FOURTH mounted panel, and `active` is why that is safe.
          `ChatView` hides rather than unmounts, so every panel's effects keep
          running — and two of those assert something about a person's ATTENTION.
          Production once wrote Crew's and Organizers' `viewing_at` 2ms apart,
          which no human can do: opening one marked the other viewed, suppressing
          its notifications and marking it read. A third panel would have been a
          third way to do that. */}
      {myTeam && (
        <div className="flex min-h-0 flex-1 flex-col" hidden={activeSegment !== "team"}>
          <FloatingChatPanel
            tripId={tripId}
            isOpen
            active={activeSegment === "team"}
            channel="team"
            teamId={myTeam.teamId}
            teamName={myTeam.teamName}
            teamColor={myTeam.color}
            memberNames={memberNames}
            textSize={textSize}
            onChangeTextSize={setTextSize}
          />
        </div>
      )}
      {canSeePlanning && (
        <div className="flex min-h-0 flex-1 flex-col" hidden={activeSegment !== "planning"}>
          <FloatingChatPanel
            tripId={tripId}
            isOpen
            active={activeSegment === "planning"}
            channel="planning"
            memberNames={memberNames}
            textSize={textSize}
            onChangeTextSize={setTextSize}
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col" hidden={activeSegment !== "news"}>
        <NewsPanel tripId={tripId} isOpen canPost={canPost} authors={authors} />
      </div>
    </div>
  );
}
