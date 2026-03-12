"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Send, MessageSquare, Users } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ── Types ─────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  trip_id: string;
  user_id: string;
  channel: "trip" | "team";
  team_id: string | null;
  text: string;
  created_at: string;
}

type DisplayMessage = Message & { _optimistic?: boolean };

interface Team {
  id: string;
  event_id: string;
  name: string;
  short_name: string;
  color: string;
  color_dim: string;
}

// ── MessageBubble ─────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isMe,
  senderName,
}: {
  message: DisplayMessage;
  isMe: boolean;
  senderName: string;
}) {
  const time = new Date(message.created_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      data-testid={`message-${message.id}`}
      className={`flex flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}
    >
      {!isMe && (
        <p className="px-1 text-xs" style={{ color: "#8b949e" }}>
          {senderName}
        </p>
      )}
      <div
        className="max-w-[80%] rounded-2xl px-4 py-2 text-sm"
        style={{
          background: isMe ? "#00d4aa22" : "#161b22",
          border: `1px solid ${isMe ? "#00d4aa44" : "#30363d"}`,
          color: "#e6edf3",
          opacity: message._optimistic ? 0.6 : 1,
        }}
      >
        {message.text}
      </div>
      <p className="px-1 text-[10px]" style={{ color: "#8b949e" }}>
        {time}
      </p>
    </div>
  );
}

// ── ChatPane ──────────────────────────────────────────────────────────────

function ChatPane({
  tripId,
  channel,
  teamId,
  myUserId,
  memberNames,
}: {
  tripId: string;
  channel: "trip" | "team";
  teamId?: string;
  myUserId: string;
  memberNames: Record<string, string>;
}) {
  const utils = trpc.useUtils();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<DisplayMessage[]>([]);

  // ── Fetch messages with polling ─────────────────────────────────────────
  const { data: messages = [] } = trpc.messages.list.useQuery(
    { tripId, channel, teamId, limit: 50 },
    {
      refetchInterval: 3000,
      staleTime: 2500,
    }
  );

  // Merge: real messages override optimistic ones with the same id
  const realIds = new Set(messages.map((m) => m.id));
  const pendingOptimistic = optimisticMessages.filter(
    (m) => !realIds.has(m.id)
  );
  const displayed: DisplayMessage[] = (messages as DisplayMessage[])
    .slice()
    .reverse()
    .concat(pendingOptimistic);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayed.length]);

  // ── Send ────────────────────────────────────────────────────────────────
  const sendMessage = trpc.messages.send.useMutation({
    onSuccess: (data) => {
      // Remove optimistic message once real one is returned
      setOptimisticMessages((prev) =>
        prev.filter((m) => m.id !== (data as unknown as Message).id)
      );
      utils.messages.list.invalidate({ tripId, channel, teamId });
    },
    onError: (_, variables) => {
      // Remove failed optimistic message
      setOptimisticMessages((prev) =>
        prev.filter((m) => m.id !== variables.id)
      );
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendMessage.isPending) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Optimistic message
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id,
        trip_id: tripId,
        user_id: myUserId,
        channel,
        team_id: teamId ?? null as string | null,
        text: trimmed,
        created_at: now,
        _optimistic: true,
      },
    ]);

    setText("");
    sendMessage.mutate({ tripId, id, channel, teamId, text: trimmed });
  }, [text, tripId, channel, teamId, myUserId, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Message list */}
      <div
        data-testid="message-list"
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <MessageSquare size={32} style={{ color: "#30363d" }} />
            <p className="text-sm" style={{ color: "#8b949e" }}>
              No messages yet. Say something!
            </p>
          </div>
        ) : (
          displayed.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg as Message & { _optimistic?: boolean }}
              isMe={msg.user_id === myUserId}
              senderName={
                memberNames[msg.user_id] ?? `User ${msg.user_id.slice(0, 6)}`
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div
        className="px-4 pb-6 pt-3"
        style={{ borderTop: "1px solid #30363d", background: "#0d1117" }}
      >
        <div
          className="flex items-end gap-2 rounded-2xl px-4 py-2"
          style={{ background: "#161b22", border: "1px solid #30363d" }}
        >
          <textarea
            data-testid="message-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message…"
            rows={1}
            className="flex-1 resize-none bg-transparent py-1 text-sm outline-none"
            style={{ color: "#e6edf3", maxHeight: "120px" }}
          />
          <button
            data-testid="send-btn"
            onClick={handleSend}
            disabled={!text.trim() || sendMessage.isPending}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-30"
            style={{ background: "#00d4aa", color: "#0d1117" }}
            aria-label="Send message"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TripMessagesPage ──────────────────────────────────────────────────────

type ChatChannel = "trip" | "team";

export default function TripMessagesPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const currentUser = useCurrentUser();
  const myUserId = currentUser?.id ?? "";

  const [activeChannel, setActiveChannel] = useState<ChatChannel>("trip");
  const [activeTeamId, setActiveTeamId] = useState<string | undefined>();

  // ── Data ──────────────────────────────────────────────────────────────
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: event } = trpc.events.getByTrip.useQuery({ tripId });
  const { data: myAssignments = [] } = trpc.teamAssignments.list.useQuery(
    { tripId, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );
  const { data: allTeams = [] } = trpc.teams.list.useQuery(
    { tripId, eventId: event?.id ?? "" },
    { enabled: !!event?.id }
  );

  // Member name lookup
  const memberNames: Record<string, string> = {};
  for (const m of members) {
    memberNames[m.user_id] =
      (m.user as { name?: string | null; email?: string | null } | null)
        ?.name ??
      (m.user as { name?: string | null; email?: string | null } | null)
        ?.email ??
      `User ${m.user_id.slice(0, 6)}`;
  }

  // Which teams am I on?
  const myTeamIds = new Set(myAssignments.map((a) => a.team_id));
  const myTeams = (allTeams as Team[]).filter((t) => myTeamIds.has(t.id));

  // Set default team when loaded
  useEffect(() => {
    if (myTeams.length > 0 && !activeTeamId) {
      setActiveTeamId(myTeams[0].id);
    }
  }, [myTeams.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTeam = (allTeams as Team[]).find((t) => t.id === activeTeamId);

  return (
    <div
      className="flex h-screen flex-col"
      style={{ background: "#0d1117", color: "#e6edf3" }}
    >
      {/* Header */}
      <header
        className="flex-shrink-0"
        style={{ background: "#161b22", borderBottom: "1px solid #30363d" }}
      >
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            onClick={() => router.push(`/trips/${tripId}`)}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: "#e6edf3" }}
            aria-label="Back to trip"
          >
            <ArrowLeft size={20} />
          </button>
          <h1
            data-testid="messages-heading"
            className="flex-1 text-base font-semibold"
            style={{ color: "#e6edf3" }}
          >
            {activeChannel === "team" && activeTeam
              ? `${activeTeam.name} Chat`
              : "Trip Chat"}
          </h1>
        </div>

        {/* Channel selector */}
        <div className="flex gap-1 px-4 pb-3">
          <button
            data-testid="channel-trip"
            onClick={() => setActiveChannel("trip")}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              background:
                activeChannel === "trip" ? "#00d4aa22" : "transparent",
              border: `1px solid ${activeChannel === "trip" ? "#00d4aa" : "#30363d"}`,
              color: activeChannel === "trip" ? "#00d4aa" : "#8b949e",
            }}
          >
            <MessageSquare size={12} />
            Trip
          </button>

          {myTeams.map((team) => (
            <button
              key={team.id}
              data-testid={`channel-team-${team.id}`}
              onClick={() => {
                setActiveChannel("team");
                setActiveTeamId(team.id);
              }}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                background:
                  activeChannel === "team" && activeTeamId === team.id
                    ? `${team.color}22`
                    : "transparent",
                border: `1px solid ${activeChannel === "team" && activeTeamId === team.id ? team.color : "#30363d"}`,
                color:
                  activeChannel === "team" && activeTeamId === team.id
                    ? team.color
                    : "#8b949e",
              }}
            >
              <Users size={12} />
              {team.short_name}
            </button>
          ))}
        </div>
      </header>

      {/* Chat pane — key forces re-mount when channel changes */}
      {myUserId && (
        <ChatPane
          key={`${activeChannel}-${activeTeamId ?? "trip"}`}
          tripId={tripId}
          channel={activeChannel}
          teamId={activeChannel === "team" ? activeTeamId : undefined}
          myUserId={myUserId}
          memberNames={memberNames}
        />
      )}
    </div>
  );
}
