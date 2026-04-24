"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, X, Maximize2, Minimize2 } from "lucide-react";
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

interface FloatingChatPanelProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  memberNames: Record<string, string>;
}

const lastReadKey = (tripId: string) => `chat-last-read-${tripId}`;

/**
 * FloatingChatPanel — the single crew-chat surface, mounted once per trip page.
 *
 * Desktop (lg+): anchored panel below the top nav, slides in from the right.
 *   Optional expand toggle widens it to ~640px for denser reading.
 * Mobile: full-width bottom sheet with a drag handle and a backdrop that
 *   closes on tap. Body scroll is locked while open.
 *
 * Open state is owned by the page; this component only renders + reads.
 */
export function FloatingChatPanel({ tripId, isOpen, onClose, memberNames }: FloatingChatPanelProps) {
  if (!isOpen) return null;
  return <FloatingChatPanelInner tripId={tripId} onClose={onClose} memberNames={memberNames} />;
}

function FloatingChatPanelInner({
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
  const [text, setText] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [expanded, setExpanded] = useState(false);

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

  // Mark read whenever the panel is open and new messages arrive.
  useEffect(() => {
    if (displayed.length === 0) return;
    const latest = displayed[displayed.length - 1];
    if (latest?.created_at) {
      try {
        localStorage.setItem(lastReadKey(tripId), latest.created_at);
        window.dispatchEvent(new CustomEvent("chat-read", { detail: { tripId } }));
      } catch {
        // localStorage unavailable — ignore
      }
    }
  }, [tripId, displayed]);

  // Mobile-only: lock body scroll while open.
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia("(max-width: 1023px)") : null;
    if (!mq) return;
    const apply = () => {
      document.body.style.overflow = mq.matches ? "hidden" : "";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      document.body.style.overflow = "";
    };
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
  }, [text, sendMessage, currentUser, tripId]);

  // Panel body — shared content between desktop + mobile wrappers.
  const body = (
    <>
      {/* Messages */}
      <div className="relative flex-1 min-h-0 overflow-y-auto">
        <div
          className="pointer-events-none sticky top-0 z-10 h-8 -mb-8"
          style={{ background: "linear-gradient(to bottom, var(--color-bt-card), transparent)" }}
        />
        <div className="space-y-1.5 px-3 py-2">
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
                    <span className="text-[10px] font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
                      {memberNames[msg.user_id] ?? "Unknown"}
                    </span>
                  )}
                </div>
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
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
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
    </>
  );

  return (
    <>
      {/* ── Desktop: anchored side panel ───────────────────────────────── */}
      <div
        className="hidden lg:flex fixed right-0 top-14 z-40 flex-col rounded-l-xl border animate-slide-in-right"
        style={{
          background: "var(--color-bt-card)",
          borderColor: "var(--color-bt-border)",
          width: expanded ? "640px" : "380px",
          height: "calc(100vh - 56px)",
          boxShadow: "var(--shadow-floating)",
          transition: "width 180ms ease",
        }}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Crew Chat
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-label={expanded ? "Shrink chat" : "Expand chat"}
              title={expanded ? "Shrink" : "Expand"}
            >
              {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ color: "var(--color-bt-text-dim)" }}
              aria-label="Close chat"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>
        </div>
        {body}
      </div>

      {/* ── Mobile: bottom sheet ───────────────────────────────────────── */}
      <div
        className="lg:hidden fixed inset-0 z-50 flex items-end"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="flex w-full flex-col rounded-t-2xl"
          style={{
            background: "var(--color-bt-card)",
            height: "85vh",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-3 pb-2">
            <div
              className="h-1 w-8 rounded-full"
              style={{ background: "var(--color-bt-border)" }}
            />
          </div>
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
          {body}
        </div>
      </div>
    </>
  );
}

/**
 * useChatUnreadCount — derives unread crew-chat count from the cached messages
 * list vs the last-read timestamp in localStorage. Updates when messages flow
 * in (query cache change) and when the panel marks itself read.
 */
export function useChatUnreadCount(tripId: string): number {
  const currentUser = useCurrentUser();
  const { data: messages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", limit: 50 },
    { enabled: !!tripId }
  );
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        setLastReadAt(localStorage.getItem(lastReadKey(tripId)));
      } catch {
        setLastReadAt(null);
      }
    };
    read();
    const onRead = (e: Event) => {
      const detail = (e as CustomEvent<{ tripId: string }>).detail;
      if (detail?.tripId === tripId) read();
    };
    window.addEventListener("chat-read", onRead);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("chat-read", onRead);
      window.removeEventListener("storage", read);
    };
  }, [tripId]);

  if (!currentUser?.id) return 0;
  if (!lastReadAt) {
    // No read marker yet — count every message from others.
    return messages.filter((m) => m.user_id !== currentUser.id).length;
  }
  const threshold = new Date(lastReadAt).getTime();
  return messages.filter((m) =>
    m.user_id !== currentUser.id && new Date(m.created_at).getTime() > threshold
  ).length;
}
