"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Lock, Send, X } from "lucide-react";

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 380;
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTripRole } from "@/hooks/useTripRole";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useModalBackButton } from "@/hooks/useModalBackButton";

type Visibility = "crew" | "planning";

interface ChatMessage {
  id: string;
  trip_id: string;
  user_id: string | null;
  channel: string;
  team_id: string | null;
  text: string;
  created_at: string;
  visibility?: Visibility;
  message_type?: "user" | "system";
  _optimistic?: boolean;
}

interface FloatingChatPanelProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  memberNames: Record<string, string>;
}

// Last-read marker is per-(trip, visibility) so the Organizers tab tracks
// its own unread count independent of Crew chat.
const lastReadKey = (tripId: string, visibility: Visibility = "crew") =>
  visibility === "crew"
    ? `chat-last-read-${tripId}`
    : `chat-last-read-${tripId}-planning`;

/**
 * FloatingChatPanel — the single chat surface, mounted once per trip page.
 *
 * Two channels (sub-channels within messages.channel='trip') exposed via
 * a tab strip at the top of the panel:
 *   - Crew        every trip member
 *   - Organizers  owner + planner (canEdit) — tab is absent for members
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
  const { canEdit } = useTripRole(tripId);
  const utils = trpc.useUtils();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("crew");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  // Mobile sheet drag state — restored from localStorage as a vh fraction.
  const [sheetHeight, setSheetHeight] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const ratio = parseFloat(localStorage.getItem("bt-chat-sheet-height") ?? "");
      if (!isNaN(ratio)) {
        const min = window.innerHeight * 0.25;
        const max = window.innerHeight * 0.95;
        return Math.round(Math.min(max, Math.max(min, ratio * window.innerHeight)));
      }
    } catch { /* localStorage unavailable */ }
    return null;
  });
  const sheetRef = useRef<HTMLDivElement>(null);
  const isSheetDragging = useRef(false);
  const sheetDragStartY = useRef(0);
  const sheetDragStartHeight = useRef(0);

  // Realtime invalidates with partial keys, so a single subscription covers
  // both visibilities (TanStack Query matches all messages.list entries that
  // share {tripId, channel}).
  useRealtimeChat(tripId, "trip");
  useModalBackButton(onClose);

  const finalSheetHeight = useRef<number>(0);
  const didSheetMove = useRef(false);

  const handleSheetDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const startY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const currentHeight = sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.85;
    isSheetDragging.current = true;
    didSheetMove.current = false;
    sheetDragStartY.current = startY;
    finalSheetHeight.current = currentHeight;

    const minHeight = window.innerHeight * 0.25;
    const maxHeight = window.innerHeight * 0.95;

    function onMove(ev: MouseEvent | TouchEvent) {
      if (!isSheetDragging.current) return;
      if (!("touches" in ev) && (ev as MouseEvent).buttons === 0) { onEnd(); return; }
      const y = "touches" in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY;
      const delta = sheetDragStartY.current - y;
      sheetDragStartY.current = y;
      const next = Math.min(maxHeight, Math.max(minHeight, finalSheetHeight.current + delta));
      finalSheetHeight.current = next;
      didSheetMove.current = true;
      if (sheetRef.current) sheetRef.current.style.height = `${next}px`;
    }
    document.body.style.userSelect = "none";

    function onEnd() {
      isSheetDragging.current = false;
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      if (didSheetMove.current) setSheetHeight(finalSheetHeight.current);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      if (ev.buttons === 0) { onUp(); return; }
      const delta = dragStartX.current - ev.clientX;
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta)));
    }
    function onUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  // Visibility-aware messages query. The router defaults visibility to
  // 'crew', but we pass it explicitly so the cache key matches the
  // unread-count hook (which also passes visibility explicitly).
  const { data: messages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", visibility, limit: 50 }
  );

  const realIds = new Set(messages.map((m) => m.id));
  const pending = optimisticMessages.filter(
    (m) => !realIds.has(m.id) && (m.visibility ?? "crew") === visibility
  );
  const displayed: ChatMessage[] = (messages as ChatMessage[])
    .slice()
    .reverse()
    .concat(pending);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayed.length, visibility]);

  // Mark read whenever the panel is open and new messages arrive — scoped
  // to the active visibility tab so the Organizers tab tracks its own
  // unread count independently of Crew.
  useEffect(() => {
    if (displayed.length === 0) return;
    const latest = displayed[displayed.length - 1];
    if (latest?.created_at) {
      try {
        localStorage.setItem(lastReadKey(tripId, visibility), latest.created_at);
        window.dispatchEvent(
          new CustomEvent("chat-read", { detail: { tripId, visibility } })
        );
      } catch {
        // localStorage unavailable — ignore
      }
    }
  }, [tripId, visibility, displayed]);

  // Persist sheet height as a vh fraction so it survives close/reopen.
  useEffect(() => {
    if (sheetHeight == null) return;
    try {
      localStorage.setItem("bt-chat-sheet-height", String(sheetHeight / window.innerHeight));
    } catch { /* localStorage unavailable */ }
  }, [sheetHeight]);

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

  // If the user switches visibility and then loses canEdit (unlikely, but
  // possible mid-session if their role changes), fall back to Crew so we
  // don't strand them on a tab that's about to disappear.
  useEffect(() => {
    if (!canEdit && visibility === "planning") setVisibility("crew");
  }, [canEdit, visibility]);

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
        visibility,
        message_type: "user",
        _optimistic: true,
      },
    ]);

    setText("");
    sendMessage.mutate({ tripId, id, channel: "trip", visibility, text: trimmed });
  }, [text, sendMessage, currentUser, tripId, visibility]);

  // ── Tab strip ────────────────────────────────────────────────────────
  // Crew is always present; Organizers is canEdit-only — non-editors don't
  // see the tab at all (not greyed-out, not hidden behind a lock badge).
  const tabStrip = (
    <div
      className="flex items-stretch gap-1 px-3 pt-2"
      style={{ borderBottom: "1px solid var(--color-bt-border)" }}
    >
      <TabButton
        active={visibility === "crew"}
        onClick={() => setVisibility("crew")}
        label="Crew"
      />
      {canEdit && (
        <TabButton
          active={visibility === "planning"}
          onClick={() => setVisibility("planning")}
          label="Organizers"
          badge="private"
        />
      )}
    </div>
  );

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
              {visibility === "crew"
                ? "No messages yet. Say something!"
                : "Just organizers here. Talk shop — the crew can't see this."}
            </p>
          )}
          {displayed.map((msg) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              isMe={msg.user_id === currentUser?.id}
              memberNames={memberNames}
            />
          ))}
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
          placeholder={
            visibility === "crew"
              ? "Say something..."
              : "Message the organizers..."
          }
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
        className="hidden lg:flex fixed right-0 top-14 bottom-0 z-30 flex-col animate-slide-in-right"
        style={{
          background: "var(--color-bt-card)",
          borderLeft: "1px solid var(--color-bt-border)",
          width: panelWidth,
        }}
      >
        {/* Drag handle — visible grip on the left edge */}
        <div
          onMouseDown={handleDragStart}
          className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center group z-10"
          aria-hidden="true"
        >
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{ background: "var(--color-bt-accent-faint)" }}
          />
          <div className="relative flex flex-col gap-[3px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-[3px] w-[3px] rounded-full transition-colors duration-150"
                style={{ background: "var(--color-bt-border)" }}
              />
            ))}
          </div>
        </div>

        <div
          className="flex flex-shrink-0 items-center justify-between gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Chat
          </p>
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
        {tabStrip}
        {body}
      </div>

      {/* ── Mobile: bottom sheet ───────────────────────────────────────── */}
      <div
        className="lg:hidden fixed inset-0 z-50 flex items-end"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          ref={sheetRef}
          className="flex w-full flex-col rounded-t-2xl"
          style={{
            background: "var(--color-bt-card)",
            height: sheetHeight != null ? sheetHeight : "85vh",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex justify-center pt-3 pb-2 cursor-ns-resize touch-none group"
            onMouseDown={handleSheetDragStart}
            onTouchStart={handleSheetDragStart}
          >
            <div className="relative flex flex-row gap-[3px] rounded px-1.5 py-1">
              <div
                className="absolute inset-0 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: "var(--color-bt-accent-faint)" }}
              />
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="relative h-[3px] w-[3px] rounded-full transition-colors duration-150"
                  style={{ background: "var(--color-bt-border)" }}
                />
              ))}
            </div>
          </div>
          <div
            className="flex items-center justify-between px-4 pb-2"
            style={{ borderBottom: "1px solid var(--color-bt-border)" }}
          >
            <p
              className="text-[13px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Chat
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
          {tabStrip}
          {body}
        </div>
      </div>
    </>
  );
}

// ── TabButton ───────────────────────────────────────────────────────────
// Two-tab pattern: active tab gets the accent underline + bright text;
// inactive tab stays dim. Optional badge slot for the "private" pill next
// to the Organizers label.

function TabButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-semibold transition-colors"
      style={{
        color: active ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
        borderBottom: `2px solid ${active ? "var(--color-bt-accent)" : "transparent"}`,
        marginBottom: -1, // overlap the parent's bottom border
      }}
    >
      {label}
      {badge && (
        <span
          className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Lock size={8} strokeWidth={2.5} />
          {badge}
        </span>
      )}
    </button>
  );
}

// ── MessageRow ──────────────────────────────────────────────────────────
// System messages render distinct from user messages: centered italic dim
// text, no avatar / bubble. User messages keep the existing bubble look.

function MessageRow({
  msg,
  isMe,
  memberNames,
}: {
  msg: ChatMessage;
  isMe: boolean;
  memberNames: Record<string, string>;
}) {
  if (msg.message_type === "system") {
    return (
      <div className="my-2 px-4 text-center">
        <p
          className="text-[11px] italic leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {msg.text}
        </p>
      </div>
    );
  }

  const time = new Date(msg.created_at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-1.5 px-1 mb-0.5">
        <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {time}
        </span>
        {!isMe && (
          <span className="text-[10px] font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
            {msg.user_id ? memberNames[msg.user_id] ?? "Unknown" : "Unknown"}
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
}

/**
 * useChatUnreadCount — derives unread crew-chat count from the cached messages
 * list vs the last-read timestamp in localStorage. Updates when messages flow
 * in (query cache change) and when the panel marks itself read.
 *
 * Scoped to the Crew tab (`visibility = 'crew'`). Organizers chat tracks its
 * own unread state via the same localStorage key family but isn't exposed via
 * this hook — the bell badge always reflects Crew unread. (Per-tab unread
 * dots inside the chat panel itself are an easy follow-up.)
 */
export function useChatUnreadCount(tripId: string): number {
  const currentUser = useCurrentUser();
  const { data: messages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", visibility: "crew", limit: 50 },
    { enabled: !!tripId }
  );
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        setLastReadAt(localStorage.getItem(lastReadKey(tripId, "crew")));
      } catch {
        setLastReadAt(null);
      }
    };
    read();
    const onRead = (e: Event) => {
      const detail = (e as CustomEvent<{ tripId: string; visibility?: Visibility }>).detail;
      if (detail?.tripId === tripId && (detail.visibility ?? "crew") === "crew") read();
    };
    window.addEventListener("chat-read", onRead);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("chat-read", onRead);
      window.removeEventListener("storage", read);
    };
  }, [tripId]);

  if (!currentUser?.id) return 0;
  // Don't count system messages — they're informational, not chat.
  const userMessages = messages.filter(
    (m) => m.message_type !== "system" && m.user_id !== currentUser.id
  );
  if (!lastReadAt) return userMessages.length;
  const threshold = new Date(lastReadAt).getTime();
  return userMessages.filter(
    (m) => new Date(m.created_at).getTime() > threshold
  ).length;
}
