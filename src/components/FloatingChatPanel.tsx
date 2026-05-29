"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, X, ChevronDown } from "lucide-react";

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 380;
// Live height of the trip bottom nav, published by BottomNav as a CSS var
// (0px when no nav is mounted). Both the desktop panel and the mobile sheet
// anchor their bottom to it so the nav stays visible and the input never hides
// behind it — identically on every viewport, regardless of the nav's actual
// measured height.
const BOTTOM_NAV_OFFSET = "var(--bt-bottomnav-height, 0px)";
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

/**
 * Per-channel last-read marker. Crew keeps the legacy un-suffixed key so
 * existing read state survives the split; planning gets its own.
 */
const lastReadKey = (tripId: string, visibility: Visibility) =>
  visibility === "crew"
    ? `chat-last-read-${tripId}`
    : `chat-last-read-${tripId}-planning`;

/**
 * FloatingChatPanel — the trip chat surface, mounted once per trip page.
 *
 * Two sub-channels live behind a tab toggle (Owner/Planner only see the
 * toggle — everyone else just gets Crew):
 *   - Crew       — every trip member (messages.visibility = 'crew')
 *   - Organizers — Owner + Planner only (messages.visibility = 'planning')
 *
 * Desktop (lg+): anchored panel below the top nav, slides in from the right.
 * Mobile: full-width bottom sheet with a drag handle and a backdrop that
 *   closes on tap. Body scroll is locked while open.
 *
 * Open state is owned by the page; this component only renders + reads.
 */
export function FloatingChatPanel({ tripId, isOpen, onClose, memberNames }: FloatingChatPanelProps) {
  if (!isOpen) return null;
  return (
    <FloatingChatPanelInner
      tripId={tripId}
      onClose={onClose}
      memberNames={memberNames}
    />
  );
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
  const { role } = useTripRole(tripId);
  const canSeeOrganizers = role === "Owner" || role === "Planner";

  const utils = trpc.useUtils();
  // Drafts are kept per channel so an unsent message stays with the tab it was
  // typed in. Switching tabs swaps the visible draft; hitting Enter only ever
  // sends the draft that belongs to the channel you're currently looking at.
  const [drafts, setDrafts] = useState<Record<Visibility, string>>({ crew: "", planning: "" });
  const [selectedChannel, setSelectedChannel] = useState<Visibility>("crew");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(DEFAULT_WIDTH);

  // Derived, not stored: non-organizers can never resolve to the planning
  // channel even if they were demoted mid-session with the panel open. The
  // channel tabs (the only caller of setSelectedChannel) only render for
  // organizers, so this guard is the single source of truth.
  const activeChannel: Visibility = canSeeOrganizers ? selectedChannel : "crew";
  const setActiveChannel = setSelectedChannel;

  // The visible draft + writer for the active channel.
  const text = drafts[activeChannel];
  const setText = useCallback(
    (value: string) => setDrafts((d) => ({ ...d, [activeChannel]: value })),
    [activeChannel]
  );

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

  // Note: the realtime subscription lives in useChatUnreadCount (always
  // mounted on the trip page), not here. A single subscription keeps both the
  // unread badge and this open panel in sync via the shared query cache, and
  // avoids two channels with the same topic colliding on the supabase singleton.
  useModalBackButton(onClose);

  const finalSheetHeight = useRef<number>(0);
  const didSheetMove = useRef(false);

  const handleSheetDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const startY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const currentHeight = sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight * 0.85;
    isSheetDragging.current = true;
    didSheetMove.current = false;
    // sheetDragStartY tracks the PREVIOUS frame's Y so delta is always incremental.
    sheetDragStartY.current = startY;
    finalSheetHeight.current = currentHeight;

    const minHeight = window.innerHeight * 0.25;
    const maxHeight = window.innerHeight * 0.95;

    function onMove(ev: MouseEvent | TouchEvent) {
      if (!isSheetDragging.current) return;
      if (!("touches" in ev) && (ev as MouseEvent).buttons === 0) { onEnd(); return; }
      const y = "touches" in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY;
      // Incremental delta: movement since last frame, not from original start.
      // This avoids the deadzone that builds up when the sheet is clamped at min/max.
      const delta = sheetDragStartY.current - y;
      sheetDragStartY.current = y;
      const next = Math.min(maxHeight, Math.max(minHeight, finalSheetHeight.current + delta));
      finalSheetHeight.current = next;
      didSheetMove.current = true;
      // Mutate the DOM directly — avoids a React re-render on every frame.
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
      // Sync React state once on release so the value survives re-renders.
      if (didSheetMove.current) setSheetHeight(finalSheetHeight.current);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
  }, [onClose]);

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

  const { data: crewMessages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", visibility: "crew", limit: 50 }
  );
  const { data: planningMessages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", visibility: "planning", limit: 50 },
    { enabled: canSeeOrganizers }
  );

  // Roster of the people who can see the Organizers channel — Owner + Planners
  // who are actually on the trip. Powers the explainer at the top of that tab.
  const { data: allMembers = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { enabled: canSeeOrganizers }
  );
  const organizers = allMembers.filter(
    (m) => (m.role === "Owner" || m.role === "Planner") && m.status === "in"
  );

  // Merge in any not-yet-confirmed optimistic messages for a channel.
  const buildDisplayed = useCallback(
    (real: ChatMessage[], visibility: Visibility): ChatMessage[] => {
      const realIds = new Set(real.map((m) => m.id));
      const pending = optimisticMessages.filter(
        (m) => m.visibility === visibility && !realIds.has(m.id)
      );
      return real.slice().reverse().concat(pending);
    },
    [optimisticMessages]
  );

  const crewDisplayed = buildDisplayed(crewMessages as ChatMessage[], "crew");
  const planningDisplayed = buildDisplayed(planningMessages as ChatMessage[], "planning");
  const displayed = activeChannel === "crew" ? crewDisplayed : planningDisplayed;

  // ── Read tracking ──────────────────────────────────────────────────────
  const [readMarks, setReadMarks] = useState<Record<Visibility, string | null>>({
    crew: null,
    planning: null,
  });

  useEffect(() => {
    const read = () => {
      try {
        setReadMarks({
          crew: localStorage.getItem(lastReadKey(tripId, "crew")),
          planning: localStorage.getItem(lastReadKey(tripId, "planning")),
        });
      } catch { /* localStorage unavailable */ }
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

  const unreadFor = (messages: ChatMessage[], visibility: Visibility): number => {
    if (!currentUser?.id) return 0;
    const others = messages.filter(
      (m) => m.user_id !== currentUser.id && m.message_type !== "system"
    );
    const lr = readMarks[visibility];
    if (!lr) return others.length;
    const threshold = new Date(lr).getTime();
    return others.filter((m) => new Date(m.created_at).getTime() > threshold).length;
  };
  const crewUnread = unreadFor(crewDisplayed, "crew");
  const planningUnread = canSeeOrganizers ? unreadFor(planningDisplayed, "planning") : 0;


  // Mark the active channel read whenever it's shown and new messages arrive.
  // The dispatched "chat-read" event is caught by the listener above, which
  // refreshes readMarks — that re-render produces a fresh `displayed` array
  // reference, which would re-trigger this effect. To avoid an infinite loop
  // we track the last-marked timestamp in a ref and only write + dispatch when
  // the newest message timestamp actually changes (per channel).
  const lastMarkedRef = useRef<Record<Visibility, string | null>>({
    crew: null,
    planning: null,
  });
  useEffect(() => {
    if (displayed.length === 0) return;
    const latest = displayed[displayed.length - 1];
    const ts = latest?.created_at;
    if (!ts) return;
    if (lastMarkedRef.current[activeChannel] === ts) return; // already marked
    lastMarkedRef.current[activeChannel] = ts;
    try {
      localStorage.setItem(lastReadKey(tripId, activeChannel), ts);
      window.dispatchEvent(new CustomEvent("chat-read", { detail: { tripId } }));
    } catch {
      // localStorage unavailable — ignore
    }
  }, [tripId, activeChannel, displayed]);

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

  const sendMessage = trpc.messages.send.useMutation({
    onSuccess: async (_, variables) => {
      await utils.messages.list.invalidate({
        tripId,
        channel: "trip",
        visibility: variables.visibility,
      });
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
        visibility: activeChannel,
        message_type: "user",
        _optimistic: true,
      },
    ]);

    setText("");
    sendMessage.mutate({
      tripId,
      id,
      channel: "trip",
      visibility: activeChannel,
      text: trimmed,
    });
  }, [text, sendMessage, currentUser, tripId, activeChannel]);

  // Active-channel accent — mirrors the CrewTab section headers: Organizers
  // takes the teal accent, Crew takes the planning-blue identity. (Highlights/
  // borders only, no fills outside the Primary send button per the style guide.)
  const isPlanningChannel = activeChannel === "planning";
  const accentVar = isPlanningChannel ? "var(--color-bt-accent)" : "var(--color-bt-planning)";
  const accentFaint = isPlanningChannel
    ? "var(--color-bt-accent-faint)"
    : "var(--color-bt-planning-faint)";
  const accentBorder = isPlanningChannel
    ? "var(--color-bt-accent-border)"
    : "var(--color-bt-planning-border)";

  // Header — channel tabs for organizers, static label otherwise. Shared
  // between the desktop panel and the mobile sheet.
  const header = canSeeOrganizers ? (
    <div className="flex items-center gap-1">
      {([
        { ch: "crew" as const, label: "Crew", unread: crewUnread },
        { ch: "planning" as const, label: "Organizers", unread: planningUnread },
      ]).map(({ ch, label, unread }) => {
        const active = activeChannel === ch;
        // Organizers = teal accent, Crew = planning-blue — same hues as the
        // CrewTab section headers so the two surfaces feel like one system.
        const org = ch === "planning";
        const fg = org ? "var(--color-bt-accent)" : "var(--color-bt-planning)";
        const faint = org ? "var(--color-bt-accent-faint)" : "var(--color-bt-planning-faint)";
        const bdr = org ? "var(--color-bt-accent-border)" : "var(--color-bt-planning-border)";
        return (
          <button
            key={ch}
            type="button"
            onClick={() => setActiveChannel(ch)}
            className="relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors"
            style={{
              color: active ? fg : "var(--color-bt-text-dim)",
              background: active ? faint : "transparent",
              border: `1px solid ${active ? bdr : "transparent"}`,
            }}
          >
            {label}
            {unread > 0 && !active && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: fg }} />
            )}
          </button>
        );
      })}
    </div>
  ) : (
    <p
      className="text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      Crew Chat
    </p>
  );

  // Panel body — shared content between desktop + mobile wrappers. It MUST be
  // its own component (not inline JSX rendered twice) so each of the two
  // simultaneously-mounted wrappers gets independent scroll/textarea refs.
  const body = (
    <ChatBody
      displayed={displayed}
      activeChannel={activeChannel}
      currentUserId={currentUser?.id}
      memberNames={memberNames}
      isPlanningChannel={isPlanningChannel}
      organizers={organizers}
      accentVar={accentVar}
      accentFaint={accentFaint}
      accentBorder={accentBorder}
      text={text}
      setText={setText}
      onSend={handleSend}
      sending={sendMessage.isPending}
    />
  );

  return (
    <>
      {/* ── Desktop: anchored side panel ───────────────────────────────── */}
      <div
        className="hidden lg:flex fixed right-0 top-14 z-30 flex-col animate-slide-in-right"
        style={{
          background: "var(--color-bt-card)",
          borderLeft: "1px solid var(--color-bt-border)",
          width: panelWidth,
          // Sit above the trip bottom nav so the input isn't hidden behind it.
          // Resolves to 0px when no nav is mounted (runs to the screen bottom).
          bottom: BOTTOM_NAV_OFFSET,
        }}
      >
        {/* Drag handle — visible grip on the left edge */}
        <div
          onMouseDown={handleDragStart}
          className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize flex items-center justify-center group z-10"
          aria-hidden="true"
        >
          {/* Hit-area highlight on hover */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{ background: "var(--color-bt-accent-faint)" }}
          />
          {/* Grip dots — always visible */}
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
          {header}
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
        {body}
      </div>

      {/* ── Mobile: bottom sheet ───────────────────────────────────────── */}
      <div
        className="lg:hidden fixed inset-0 z-50 flex items-end"
        style={{
          background: "var(--color-bt-overlay)",
          // Same as desktop: stop the sheet + backdrop at the top of the trip
          // bottom nav so it stays visible/usable and the input never hides
          // behind it. Resolves to 0px when no nav is mounted.
          bottom: BOTTOM_NAV_OFFSET,
        }}
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
            {header}
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

// ── ChatBody ────────────────────────────────────────────────────────────────
// Messages list + composer. Rendered inside BOTH the desktop side panel and the
// mobile bottom sheet. Both wrappers are mounted at once (one is CSS-hidden, not
// unmounted), so this MUST be a component rather than inline JSX shared via a
// single ref — otherwise scrollRef/bottomRef/textareaRef would all point at
// whichever instance committed last (the hidden one), and auto-scroll/autosize
// would silently target an off-screen node. As its own component each instance
// owns independent refs and the visible surface behaves correctly.
interface ChatBodyProps {
  displayed: ChatMessage[];
  activeChannel: Visibility;
  currentUserId: string | undefined;
  memberNames: Record<string, string>;
  isPlanningChannel: boolean;
  organizers: { user_id: string | null; displayName: string }[];
  accentVar: string;
  accentFaint: string;
  accentBorder: string;
  text: string;
  setText: (value: string) => void;
  onSend: () => void;
  sending: boolean;
}

function ChatBody({
  displayed,
  activeChannel,
  currentUserId,
  memberNames,
  isPlanningChannel,
  organizers,
  accentVar,
  accentFaint,
  accentBorder,
  text,
  setText,
  onSend,
  sending,
}: ChatBodyProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Messenger-style jump-to-latest affordance. `isAtBottom` drives button
  // visibility (state so it re-renders as you scroll); `atBottomRef` mirrors it
  // for the new-message effect to read without re-subscribing. `hasNew`
  // emphasizes the button when messages land while you're scrolled up.
  const atBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  // Auto-grow the composer up to ~3 lines, then scroll internally. Runs on
  // every text change so it also collapses back to one line after a send and
  // resizes to the other channel's draft when the active tab changes.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
    atBottomRef.current = true;
    setIsAtBottom(true);
    setHasNew(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) setHasNew(false);
  }, []);

  // Auto-scroll on new content when pinned to the bottom (or it's your own
  // send); otherwise leave the viewport put — the jump button stays visible
  // because you're scrolled up, and `hasNew` lights it up to flag the new
  // message. prevChannelRef starts as "" (not a valid channel) so the first
  // run jumps instantly to the newest message on open.
  const prevLenRef = useRef(0);
  const prevChannelRef = useRef<string>("");
  useEffect(() => {
    const len = displayed.length;

    if (prevChannelRef.current !== activeChannel) {
      prevChannelRef.current = activeChannel;
      prevLenRef.current = len;
      scrollToBottom("auto");
      return;
    }

    const grew = len > prevLenRef.current;
    prevLenRef.current = len;
    if (!grew || len === 0) return;

    const last = displayed[len - 1];
    const isMine = last?.user_id === currentUserId;
    if (isMine || atBottomRef.current) {
      scrollToBottom("smooth");
    } else {
      setHasNew(true);
    }
  }, [displayed, activeChannel, currentUserId, scrollToBottom]);

  return (
    <>
      {/* Pinned explainer — stays put while messages scroll beneath it. */}
      {isPlanningChannel && (
        <div className="flex-shrink-0 px-3 pt-2">
          <div
            className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
            style={{
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <p
              className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Organizers only
            </p>
            <p>
              A private channel for the trip&rsquo;s owner and organizers to
              sort out planning away from the full crew.
            </p>
            {organizers.length > 0 && (
              <p className="mt-1.5">
                <span className="mr-1.5">In this chat:</span>
                <span style={{ color: "var(--color-bt-text)", fontWeight: 500 }}>
                  {organizers
                    .map((m) =>
                      m.user_id === currentUserId
                        ? `${m.displayName} (you)`
                        : m.displayName
                    )
                    .join(", ")}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden"
        >
          <div
            className="pointer-events-none sticky top-0 z-10 h-8 -mb-8"
            style={{ background: "linear-gradient(to bottom, var(--color-bt-card), transparent)" }}
          />
          <div className="space-y-1.5 px-3 py-2">
            {displayed.length === 0 && (
              <p className="text-center text-xs mt-8" style={{ color: "var(--color-bt-text-dim)" }}>
                {isPlanningChannel
                  ? "No organizer chatter yet — this channel is just for owners and organizers."
                  : "No messages yet. Say something!"}
              </p>
            )}
            {displayed.map((msg) => {
              // System lifecycle lines render centered + muted, no bubble.
              if (msg.message_type === "system") {
                return (
                  <div key={msg.id} className="flex justify-center py-1">
                    <span
                      className="text-[10px] italic px-2 text-center"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      {msg.text}
                    </span>
                  </div>
                );
              }

              const isMe = msg.user_id === currentUserId;
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
                        {msg.user_id ? memberNames[msg.user_id] ?? "Unknown" : "Unknown"}
                      </span>
                    )}
                  </div>
                  <div
                    className="max-w-[85%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words"
                    style={{
                      background: isMe ? accentFaint : "var(--color-bt-card-raised)",
                      border: `1px solid ${isMe ? accentBorder : "var(--color-bt-border)"}`,
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
        {/* Messenger-style jump-to-latest — hovers above the message window
            whenever you're scrolled up. Neutral by default; fills with the
            channel accent (plus a badge dot) when new messages arrived while
            you were away. */}
        {!isAtBottom && (
          <button
            onClick={() => scrollToBottom("smooth")}
            className="absolute bottom-3 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full transition-colors"
            style={{
              background: hasNew ? accentVar : "var(--color-bt-card-float)",
              color: hasNew ? "var(--color-bt-base)" : "var(--color-bt-text)",
              border: hasNew ? "none" : "1px solid var(--color-bt-border)",
              boxShadow: "var(--shadow-floating)",
            }}
            aria-label={hasNew ? "Jump to new messages" : "Scroll to latest"}
          >
            <ChevronDown size={18} />
          </button>
        )}
      </div>

      {/* Input */}
      <div
        className="flex items-end gap-2 px-3 py-2"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={isPlanningChannel ? "Message the organizers..." : "Say something..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          className="min-w-0 flex-1 resize-none rounded-2xl border px-3 py-1.5 text-sm leading-5 outline-none"
          style={{
            background: "var(--color-bt-base)",
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text)",
            maxHeight: "4.5rem", // ~3 lines (leading-5 = 20px × 3 + py-1.5), then scrolls
            overflowY: "auto",
          }}
        />
        <button
          onClick={onSend}
          disabled={sending || !text.trim()}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-30"
          style={{ background: accentVar, color: "var(--color-bt-base)" }}
          aria-label="Send message"
        >
          <Send size={13} />
        </button>
      </div>
    </>
  );
}

/**
 * useChatUnreadCount — total unread across the channels the viewer can see
 * (Crew always; Organizers when Owner/Planner). Derived from the cached
 * messages lists vs the per-channel last-read timestamps in localStorage.
 * System lifecycle lines never count toward unread.
 */
export function useChatUnreadCount(tripId: string): number {
  const currentUser = useCurrentUser();
  const { role } = useTripRole(tripId);
  const canSeeOrganizers = role === "Owner" || role === "Planner";

  // Subscribe to realtime here (this hook is always mounted on the trip page).
  // On every new message it invalidates the cached messages lists, so both the
  // unread badge and an open FloatingChatPanel refetch and stay live — even
  // when the panel is closed. The panel deliberately does NOT also subscribe.
  useRealtimeChat(tripId, "trip");

  const { data: crewMessages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", visibility: "crew", limit: 50 },
    { enabled: !!tripId }
  );
  const { data: planningMessages = [] } = trpc.messages.list.useQuery(
    { tripId, channel: "trip", visibility: "planning", limit: 50 },
    { enabled: !!tripId && canSeeOrganizers }
  );

  const [readMarks, setReadMarks] = useState<Record<Visibility, string | null>>({
    crew: null,
    planning: null,
  });

  useEffect(() => {
    const read = () => {
      try {
        setReadMarks({
          crew: localStorage.getItem(lastReadKey(tripId, "crew")),
          planning: localStorage.getItem(lastReadKey(tripId, "planning")),
        });
      } catch {
        setReadMarks({ crew: null, planning: null });
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

  const countChannel = (
    messages: { user_id: string | null; created_at: string; message_type?: string }[],
    visibility: Visibility
  ): number => {
    const others = messages.filter(
      (m) => m.user_id !== currentUser.id && m.message_type !== "system"
    );
    const lr = readMarks[visibility];
    if (!lr) return others.length;
    const threshold = new Date(lr).getTime();
    return others.filter((m) => new Date(m.created_at).getTime() > threshold).length;
  };

  const crew = countChannel(crewMessages, "crew");
  const planning = canSeeOrganizers ? countChannel(planningMessages, "planning") : 0;
  return crew + planning;
}
