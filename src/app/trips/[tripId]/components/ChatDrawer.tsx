"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useModalBackButton } from "@/hooks/useModalBackButton";

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

interface ChatDrawerProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  memberNames: Record<string, string>;
}

export function ChatDrawer({ tripId, isOpen, onClose, memberNames }: ChatDrawerProps) {
  if (!isOpen) return null;
  return <ChatDrawerInner tripId={tripId} onClose={onClose} memberNames={memberNames} />;
}

function ChatDrawerInner({
  tripId,
  onClose,
  memberNames,
}: {
  tripId: string;
  onClose: () => void;
  memberNames: Record<string, string>;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);

  useRealtimeChat(tripId, "trip");
  useModalBackButton(onClose);

  const { data: messages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", limit: 50 }
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

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const sendMessage = trpc.messages.send.useMutation({
    onSuccess: async () => {
      await utils.messages.list.invalidate({ tripId, channel: "trip" });
    },
    onError: (_, variables) => {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== variables.id));
    },
  });

  const handleSend = useCallback(() => {
    const current = textareaRef.current?.value ?? text;
    const trimmed = current.trim();
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
    if (textareaRef.current) textareaRef.current.value = "";
    sendMessage.mutate({ tripId, id, channel: "trip", text: trimmed });
  }, [text, sendMessage, currentUser, tripId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:hidden"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="flex w-full flex-col rounded-t-2xl"
        style={{
          background: "var(--color-bt-card)",
          height: "70vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div
            className="h-1 w-8 rounded-full"
            style={{ background: "var(--color-bt-border)" }}
          />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 pb-2"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <p
            className="text-[13px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Crew Chat
          </p>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3 min-h-0">
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
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-1.5 px-1 mb-0.5">
                  <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
                    {time}
                  </span>
                  {!isMe && (
                    <span className="text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
                      {memberNames[msg.user_id] ?? "Unknown"}
                    </span>
                  )}
                </div>
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-2 text-sm"
                  style={{
                    background: isMe ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                    border: `1px solid ${isMe ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                    color: "var(--color-bt-text)",
                    opacity: msg._optimistic ? 0.6 : 1,
                  }}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <input
            ref={textareaRef}
            type="text"
            placeholder="Say something..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            className="min-w-0 flex-1 rounded-full border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
          <button
            onClick={handleSend}
            disabled={sendMessage.isPending || !text.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-30"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            aria-label="Send message"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
