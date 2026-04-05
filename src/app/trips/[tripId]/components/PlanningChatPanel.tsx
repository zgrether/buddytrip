"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";

interface ChatMessage {
  id: string;
  trip_id: string;
  user_id: string;
  channel: string;
  team_id: string | null;
  text: string;
  created_at: string;
  _optimistic?: boolean;
}

interface SidebarChatPanelProps {
  tripId: string;
  memberNames: Record<string, string>;
}

/** Shared desktop sidebar chat — used in both IDEA and PLANNING stages */
export function SidebarChatPanel({ tripId, memberNames }: SidebarChatPanelProps) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);

  useRealtimeChat(tripId, "trip");

  const { data: messages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", limit: 30 }
  );

  const realIds = new Set(messages.map((m) => m.id));
  const pending = optimisticMessages.filter((m) => !realIds.has(m.id));
  const displayed: ChatMessage[] = (messages as ChatMessage[])
    .slice()
    .reverse()
    .concat(pending);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayed.length]);

  const sendMessage = trpc.messages.send.useMutation({
    onSuccess: async () => {
      await utils.messages.list.invalidate({ tripId, channel: "trip" });
    },
    onError: (_, variables) => {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== variables.id));
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendMessage.isPending || !currentUser?.id) return;

    const id = crypto.randomUUID();
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id,
        trip_id: tripId,
        user_id: currentUser.id,
        channel: "trip",
        team_id: null,
        text: trimmed,
        created_at: new Date().toISOString(),
        _optimistic: true,
      },
    ]);

    setText("");
    sendMessage.mutate({ tripId, id, channel: "trip", text: trimmed });
  }, [text, sendMessage, currentUser?.id, tripId]);

  return (
    <div
      className="hidden lg:flex flex-col rounded-xl border"
      style={{
        background: "var(--color-bt-card)",
        borderColor: "var(--color-bt-border)",
        minHeight: "300px",
        maxHeight: "500px",
      }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 px-3 py-2"
        style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Crew Chat
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-2 min-h-0">
        {displayed.length === 0 && (
          <p className="text-center text-xs mt-8" style={{ color: "var(--color-bt-text-dim)" }}>
            No messages yet. Say something!
          </p>
        )}
        {displayed.map((msg) => {
          const isMe = msg.user_id === currentUser?.id;
          const time = new Date(msg.created_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          return (
            <div
              key={msg.id}
              className={`flex flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}
            >
              {!isMe && (
                <p className="px-1 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                  {memberNames[msg.user_id] ?? "Unknown"}
                </p>
              )}
              <div
                className="max-w-[85%] rounded-2xl px-3 py-1.5 text-sm"
                style={{
                  background: isMe ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                  border: `1px solid ${isMe ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                  color: "var(--color-bt-text)",
                  opacity: msg._optimistic ? 0.6 : 1,
                }}
              >
                {msg.text}
              </div>
              <p className="px-1 text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {time}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        <input
          type="text"
          placeholder="Say something..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          className="min-w-0 flex-1 rounded-full border px-3 py-1.5 text-sm outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
          }}
        />
        <button
          onClick={handleSend}
          disabled={sendMessage.isPending || !text.trim()}
          className="flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-30"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          aria-label="Send message"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
