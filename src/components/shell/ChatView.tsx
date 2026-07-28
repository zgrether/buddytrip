"use client";

import { useState } from "react";
import { MessageCircle, Newspaper } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, type NewsAuthorMeta } from "@/components/NewsPanel";

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
export function ChatView({ tripId, canPost }: { tripId: string; canPost: boolean }) {
  const [stream, setStream] = useState<"chat" | "news">("chat");

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
            ["chat", "Chat", MessageCircle],
            ["news", "News", Newspaper],
          ] as const
        ).map(([id, label, Icon]) => {
          const selected = stream === id;
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

      <div hidden={stream !== "chat"}>
        <FloatingChatPanel tripId={tripId} isOpen embedded onClose={noop} memberNames={memberNames} />
      </div>
      <div hidden={stream !== "news"}>
        <NewsPanel tripId={tripId} isOpen embedded onClose={noop} canPost={canPost} authors={authors} />
      </div>
    </div>
  );
}

/** A tab has no dismiss — see the header. */
function noop() {}
