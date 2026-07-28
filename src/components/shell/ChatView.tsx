"use client";

import { useState } from "react";
import { MessageCircle, ClipboardList, Newspaper } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, type NewsAuthorMeta } from "@/components/NewsPanel";
import { useTripRole } from "@/hooks/useTripRole";

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
 * another tab, and the panels' own close affordances would otherwise strand the
 * user on an empty surface with no way back.
 */
type Stream = "crew" | "planning" | "news";

export function ChatView({ tripId, canPost }: { tripId: string; canPost: boolean }) {
  /**
   * Three segments: Crew · Planning · News, defaulting to Crew.
   *
   * PLANNING IS CONDITIONAL. It only appears for a current Owner/Organizer, so
   * most crew see Crew · News. `useTripRole` reads tripMembers.list, which
   * `useRealtimeMembers` invalidates on every trip_members change — so a
   * newly-designated organizer gets the segment WITHOUT a remount, and a demoted
   * one loses it immediately. A mount-time read would have left them staring at
   * the wrong set of segments until they navigated away and back, which is the
   * same propagation gap the captain grant had.
   *
   * If the role flips away while Planning is selected, the selection falls back
   * to Crew during render — the panel refuses the channel anyway, so without this
   * the segment bar would highlight a tab showing someone else's content.
   */
  const { canEdit: canSeePlanning } = useTripRole(tripId);
  const [stream, setStream] = useState<Stream>("crew");
  const activeStream: Stream = stream === "planning" && !canSeePlanning ? "crew" : stream;

  // Crew names for authorship. STRUCTURE_QUERY — this is slow-changing roster
  // data, and the Cup tab already holds the same key, so on a warm shell it costs
  // nothing.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId }, STRUCTURE_QUERY);

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
        {(
          [
            ["crew", "Crew", MessageCircle],
            ...(canSeePlanning ? [["planning", "Planning", ClipboardList] as const] : []),
            ["news", "News", Newspaper],
          ] as const
        ).map(([id, label, Icon]) => {
          const selected = activeStream === id;
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
