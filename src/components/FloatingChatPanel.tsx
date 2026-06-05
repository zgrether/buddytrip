"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Send, X, ChevronDown, MessageCircle } from "lucide-react";
import {
  RAIL_DEFAULT_WIDTH,
  clampRailWidth,
  readRailWidth,
  persistRailWidth,
  readRailSheetHeight,
  persistRailSheetHeight,
} from "@/lib/railLayout";

// Chat history page size — how many messages each lazy "load older" fetch pulls.
const CHAT_PAGE_SIZE = 50;
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
import { ScrollLock } from "@/hooks/useScrollLock";

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
  /** IDEA stage: everyone on the trip is an Owner/Organizer, so the Crew
   *  channel is redundant — collapse to a single Organizers channel. */
  ideaStage?: boolean;
  onClose: () => void;
  memberNames: Record<string, string>;
}

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
export function FloatingChatPanel({ tripId, isOpen, ideaStage, onClose, memberNames }: FloatingChatPanelProps) {
  if (!isOpen) return null;
  return (
    <FloatingChatPanelInner
      tripId={tripId}
      ideaStage={ideaStage}
      onClose={onClose}
      memberNames={memberNames}
    />
  );
}

function FloatingChatPanelInner({
  tripId,
  ideaStage = false,
  onClose,
  memberNames,
}: {
  tripId: string;
  ideaStage?: boolean;
  onClose: () => void;
  memberNames: Record<string, string>;
}) {
  const currentUser = useCurrentUser();
  const { role } = useTripRole(tripId);
  const canSeeOrganizers = role === "Owner" || role === "Planner";
  // IDEA stage collapses to a single Organizers channel: every member is an
  // Owner/Organizer, so the Crew channel would just duplicate it. The tab
  // toggle is hidden and the channel is pinned to 'planning'.
  const ideaSolo = ideaStage && canSeeOrganizers;

  const utils = trpc.useUtils();
  // Drafts are kept per channel so an unsent message stays with the tab it was
  // typed in. Switching tabs swaps the visible draft; hitting Enter only ever
  // sends the draft that belongs to the channel you're currently looking at.
  const [drafts, setDrafts] = useState<Record<Visibility, string>>({ crew: "", planning: "" });
  const [selectedChannel, setSelectedChannel] = useState<Visibility>("crew");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  // Width is shared with the News rail (see src/lib/railLayout.ts) so the two
  // panels act as radio buttons — switching keeps the same size. Read the last
  // persisted width on mount; persist on every change.
  const [panelWidth, setPanelWidth] = useState<number>(readRailWidth);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(RAIL_DEFAULT_WIDTH);

  useEffect(() => {
    persistRailWidth(panelWidth);
  }, [panelWidth]);

  // Derived, not stored: non-organizers can never resolve to the planning
  // channel even if they were demoted mid-session with the panel open. The
  // channel tabs (the only caller of setSelectedChannel) only render for
  // organizers, so this guard is the single source of truth.
  const activeChannel: Visibility = ideaSolo
    ? "planning"
    : canSeeOrganizers
      ? selectedChannel
      : "crew";
  const setActiveChannel = setSelectedChannel;

  // The visible draft + writer for the active channel.
  const text = drafts[activeChannel];
  const setText = useCallback(
    (value: string) => setDrafts((d) => ({ ...d, [activeChannel]: value })),
    [activeChannel]
  );

  // Mobile sheet drag state — shared with the News rail (vh fraction).
  const [sheetHeight, setSheetHeight] = useState<number | null>(readRailSheetHeight);
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
      setPanelWidth(clampRailWidth(dragStartWidth.current + delta));
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

  // Chat history is paginated, not loaded all at once: each page is the newest
  // PAGE_SIZE messages older than the previous page's cursor (server orders
  // created_at DESC and applies `.lt(created_at, cursor)`). Older history is
  // pulled in on demand as the viewer scrolls toward the top — so opening a
  // trip with 10k messages fetches 50 rows, not 10k. `getNextPageParam` hands
  // back the oldest loaded row's timestamp as the next cursor, and returns
  // undefined once a short page proves there's nothing older left.
  const crewQuery = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "crew", limit: CHAT_PAGE_SIZE },
    {
      getNextPageParam: (lastPage) =>
        lastPage.length === CHAT_PAGE_SIZE
          ? lastPage[lastPage.length - 1].created_at
          : undefined,
    }
  );
  const planningQuery = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "planning", limit: CHAT_PAGE_SIZE },
    {
      enabled: canSeeOrganizers,
      getNextPageParam: (lastPage) =>
        lastPage.length === CHAT_PAGE_SIZE
          ? lastPage[lastPage.length - 1].created_at
          : undefined,
    }
  );

  // Pages come back newest-first within each page and progressively older across
  // pages, so the flattened list is fully created_at DESC. buildDisplayed
  // reverses it to chronological order for rendering.
  const crewMessages = (crewQuery.data?.pages.flat() ?? []) as ChatMessage[];
  const planningMessages = (planningQuery.data?.pages.flat() ?? []) as ChatMessage[];

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

  // ── Read tracking (server-backed, cross-device) ─────────────────────────
  // Read state lives in chat_reads server-side, so the unread badge + the
  // new-messages divider follow the account across devices. Both this panel
  // and useChatUnreadCount read the same readState query, and markRead
  // invalidates it — so marking read here updates the badge with no manual
  // cross-component plumbing.
  const { data: readStateData } = trpc.messages.readState.useQuery(
    { tripId },
    { enabled: !!tripId }
  );
  const readMarks: Record<Visibility, string | null> = readStateData ?? {
    crew: null,
    planning: null,
  };

  // ── New-messages divider boundary ───────────────────────────────────────
  // Freeze each channel's last-read timestamp at the moment the panel opens —
  // before the markRead effect below advances it to now() — by reading the
  // cached readState once in a lazy initializer (the badge hook on the trip
  // page keeps that cache warm). The "New" divider sits at this frozen boundary:
  // the first message from someone else newer than it. It stays put for the
  // whole session even as we mark the channel read. null = never read / unknown
  // at open, so no divider is drawn.
  const [dividerSnapshots] = useState<Record<Visibility, string | null>>(() => {
    const cached = utils.messages.readState.getData({ tripId });
    return { crew: cached?.crew ?? null, planning: cached?.planning ?? null };
  });
  const dividerSnapshot = dividerSnapshots[activeChannel];

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
  // markRead stamps the server clock; on success it invalidates the readState
  // query, refreshing readMarks here AND the badge in useChatUnreadCount. That
  // refresh produces a fresh `displayed` reference which would re-trigger this
  // effect, so we track the last-marked newest-message timestamp in a ref and
  // only fire when it actually changes (per channel) — no mutation loop.
  const { mutate: markReadMutate } = trpc.messages.markRead.useMutation({
    onSuccess: () => {
      utils.messages.readState.invalidate({ tripId });
    },
  });
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
    markReadMutate({ tripId, visibility: activeChannel });
  }, [tripId, activeChannel, displayed, markReadMutate]);

  // Persist sheet height (shared with News) so it survives close/reopen/switch.
  useEffect(() => {
    if (sheetHeight == null) return;
    persistRailSheetHeight(sheetHeight);
  }, [sheetHeight]);

  // Mobile-only scroll lock: the bottom sheet locks the page behind it, but
  // the desktop side panel must leave the page scrollable. Both subtrees live
  // in the same (CSS-toggled) render, so we track the viewport and only enable
  // <ScrollLock> on the mobile sheet at the mobile breakpoint.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobileViewport(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
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

  // Plain function, not useCallback: React Compiler memoizes it automatically.
  // A manual dep array here conflicted with the compiler's inferred deps
  // ("existing memoization could not be preserved"), which made it bail on the
  // whole component. Letting the compiler own the memoization fixes that.
  const handleSend = () => {
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
  };

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

  // Unified title bar — matches the News rail: a "Chat" title row, with the
  // channel tabs dropped to a SECOND row beneath it (News has no tabs; this is
  // the only structural difference between the two panels). The tabs row only
  // renders when there's a real choice — organizers see Crew/Organizers; in
  // the IDEA stage (everyone's an organizer) and for plain members there's a
  // single channel, so the title alone carries it.
  const titleRow = (
    <span
      className="inline-flex items-center gap-2"
      style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}
    >
      <MessageCircle size={17} style={{ color: "var(--color-bt-accent)" }} /> Chat
    </span>
  );
  const tabsRow =
    canSeeOrganizers && !ideaSolo ? (
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
    ) : null;

  // Panel body — shared content between desktop + mobile wrappers. It MUST be
  // its own component (not inline JSX rendered twice) so each of the two
  // simultaneously-mounted wrappers gets independent scroll/textarea refs.
  const activeQuery = activeChannel === "crew" ? crewQuery : planningQuery;
  const body = (
    <ChatBody
      displayed={displayed}
      activeChannel={activeChannel}
      currentUserId={currentUser?.id}
      lastReadSnapshot={dividerSnapshot}
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
      onLoadOlder={activeQuery.fetchNextPage}
      hasOlder={!!activeQuery.hasNextPage}
      loadingOlder={activeQuery.isFetchingNextPage}
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
          // Top edge butts against the app's top bar; without a border the
          // panel bleeds into it. Mirrors the bottom edge, which reads as
          // separated thanks to the bottom nav's own top border.
          borderTop: "1px solid var(--color-bt-border)",
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
          className="flex flex-shrink-0 items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          {titleRow}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
            aria-label="Close chat"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        {/* Channel tabs live BELOW the divider bar (the title's own band). */}
        {tabsRow && <div className="flex-shrink-0 px-3 py-2">{tabsRow}</div>}
        {body}
      </div>

      {/* ── Mobile: bottom sheet ─────────────────────────────────────────────
          Starts BELOW the title bar (top-14 = the 56px nav) so the News/Chat
          buttons stay lit and tappable above the scrim — tap News to swap
          panels in place without closing first. maxHeight 100% keeps the sheet
          from riding up over the bar. */}
      <ScrollLock enabled={isMobileViewport}>
      <div
        className="lg:hidden fixed inset-x-0 top-14 z-50 flex items-end"
        style={{
          background: "var(--color-bt-overlay)",
          // Stop the sheet + backdrop at the top of the trip bottom nav so it
          // stays visible/usable and the input never hides behind it. Resolves
          // to 0px when no nav is mounted.
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
            maxHeight: "100%",
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
            className="flex flex-shrink-0 items-center gap-2 px-3 pb-2"
            style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
          >
            {titleRow}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          </div>
          {/* Channel tabs live BELOW the divider bar. */}
          {tabsRow && <div className="flex-shrink-0 px-3 py-2">{tabsRow}</div>}
          {body}
        </div>
      </div>
      </ScrollLock>
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
  /** Frozen last-read timestamp for the active channel; the "New" divider sits
   *  before the first other-authored message newer than this. null = no divider. */
  lastReadSnapshot: string | null;
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
  onLoadOlder: () => void;
  hasOlder: boolean;
  loadingOlder: boolean;
}

function ChatBody({
  displayed,
  activeChannel,
  currentUserId,
  lastReadSnapshot,
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
  onLoadOlder,
  hasOlder,
  loadingOlder,
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
  // When older history is pulled in at the top, the list grows upward and would
  // shove the viewport down. We record the distance-from-bottom at fetch time
  // and restore it after the prepend lands (in the layout effect below) so the
  // messages you were reading stay visually fixed.
  const pendingAnchorRef = useRef<number | null>(null);
  // Anchor for the "New" divider so we can scroll it into view when the channel
  // first opens (rather than always jumping to the very bottom).
  const dividerRef = useRef<HTMLDivElement>(null);

  // The first message from someone else that's newer than the frozen last-read
  // boundary — the divider renders just above it. null when there's nothing to
  // mark (never read, or everything already seen).
  const firstUnreadId = useMemo(() => {
    if (!lastReadSnapshot) return null;
    const threshold = new Date(lastReadSnapshot).getTime();
    const first = displayed.find(
      (m) =>
        m.message_type !== "system" &&
        m.user_id !== currentUserId &&
        new Date(m.created_at).getTime() > threshold
    );
    return first?.id ?? null;
  }, [displayed, lastReadSnapshot, currentUserId]);

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

  // Land on the "New" divider (channel-switch case). No setState here: the
  // scrollIntoView moves the container's scrollTop, which fires handleScroll
  // and mirrors the real position into isAtBottom. The synchronous ref write
  // is what the append logic below reads.
  const scrollToDivider = useCallback(() => {
    dividerRef.current?.scrollIntoView({ block: "center" });
    atBottomRef.current = false;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) setHasNew(false);

    // Near the top — pull in the next page of older history. Capture the
    // distance-from-bottom now so the layout effect can pin the viewport once
    // the older messages prepend. Guard on pendingAnchorRef so a burst of
    // scroll events doesn't queue multiple fetches before the first lands.
    if (el.scrollTop < 120 && hasOlder && !loadingOlder && pendingAnchorRef.current == null) {
      pendingAnchorRef.current = el.scrollHeight - el.scrollTop;
      onLoadOlder();
    }
  }, [hasOlder, loadingOlder, onLoadOlder]);

  // React to changes in the message list. Three distinct cases, told apart by
  // length growth + whether the NEWEST message (last in the chronological list)
  // changed:
  //   • channel switch  → jump instantly to the newest message
  //   • prepend (older history loaded) → length grew but the last id is the
  //     same; restore the saved scroll position so the view doesn't jump
  //   • append (a new message arrived) → last id changed; auto-scroll if you're
  //     pinned to the bottom or it's your own send, otherwise flag `hasNew`
  // Runs as a layout effect so the prepend anchor is applied before the browser
  // paints — no visible jump. prevChannelRef starts as "" so the first run
  // jumps instantly to the newest message on open.
  //
  // This is a genuine DOM-synchronization effect: it reconciles scroll position
  // and the unread-pill flag against the message list (external data). React
  // Compiler's set-state-in-effect rule fires on the scroll/flag writes here,
  // but those are exactly the "update React state from an external system" case
  // the rule's own docs allow — so the few writes below are disabled inline.
  const prevLenRef = useRef(0);
  const prevLastIdRef = useRef<string | null>(null);
  const prevChannelRef = useRef<string>("");
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const len = displayed.length;
    const lastId = len > 0 ? displayed[len - 1].id : null;

    if (prevChannelRef.current !== activeChannel) {
      prevChannelRef.current = activeChannel;
      prevLenRef.current = len;
      prevLastIdRef.current = lastId;
      pendingAnchorRef.current = null;
      // Land on the "New" divider if this channel has unread history, so you
      // start reading exactly where you left off; otherwise jump to the newest.
      if (dividerRef.current && el) {
        scrollToDivider();
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM sync: mirrors scroll position into state
        scrollToBottom("auto");
      }
      return;
    }

    const grew = len > prevLenRef.current;
    const prepended = grew && lastId === prevLastIdRef.current;
    const appended = grew && lastId !== prevLastIdRef.current;
    prevLenRef.current = len;
    prevLastIdRef.current = lastId;

    // Older history landed at the top — pin the viewport by distance-from-bottom.
    if (prepended && el && pendingAnchorRef.current != null) {
      el.scrollTop = el.scrollHeight - pendingAnchorRef.current;
      pendingAnchorRef.current = null;
      return;
    }

    if (!appended) return;

    const last = displayed[len - 1];
    const isMine = last?.user_id === currentUserId;
    if (isMine || atBottomRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM sync: mirrors scroll position into state
      scrollToBottom("smooth");
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- new-message pill flagged from external data
      setHasNew(true);
    }
  }, [displayed, activeChannel, currentUserId, scrollToBottom, scrollToDivider]);

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
            {loadingOlder && (
              <p
                className="py-1 text-center text-[10px] italic"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                Loading earlier messages…
              </p>
            )}
            {displayed.length === 0 && (
              <div
                className="flex items-center justify-center text-center"
                style={{ padding: "40px 8px" }}
              >
                <div className="flex max-w-[320px] flex-col items-center gap-[13px]">
                  <span
                    className="inline-flex items-center justify-center"
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 15,
                      background: "var(--color-bt-accent-faint)",
                      border: "1px solid var(--color-bt-accent-border)",
                    }}
                  >
                    <MessageCircle size={24} style={{ color: "var(--color-bt-accent)" }} />
                  </span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>
                      {isPlanningChannel ? "Organizers only" : "No messages yet"}
                    </div>
                    <p
                      style={{
                        margin: "7px 0 0",
                        fontSize: 13,
                        lineHeight: 1.45,
                        color: "var(--color-bt-text-dim)",
                        textWrap: "pretty",
                      }}
                    >
                      {isPlanningChannel
                        ? "Just owners and organizers in here. Hash out the plans the crew doesn't need to see yet."
                        : "Say something — this is where the whole crew talks. Your first message sets the tone."}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {displayed.map((msg) => {
              // "New" divider — sits just above the first message that arrived
              // since you last read this channel. accent-colored hairline so it
              // reads as a soft boundary, not an alarm.
              const divider =
                msg.id === firstUnreadId ? (
                  <div ref={dividerRef} className="flex items-center gap-2 py-1.5">
                    <div className="h-px flex-1" style={{ background: accentBorder }} />
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: accentVar }}
                    >
                      New
                    </span>
                    <div className="h-px flex-1" style={{ background: accentBorder }} />
                  </div>
                ) : null;

              // System lifecycle lines render centered + muted, no bubble.
              if (msg.message_type === "system") {
                return (
                  <Fragment key={msg.id}>
                    {divider}
                    <div className="flex justify-center py-1">
                      <span
                        className="text-[10px] italic px-2 text-center"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {msg.text}
                      </span>
                    </div>
                  </Fragment>
                );
              }

              const isMe = msg.user_id === currentUserId;
              const time = new Date(msg.created_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              });
              return (
                <Fragment key={msg.id}>
                  {divider}
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
                </Fragment>
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
            // One-line floor. The auto-grow effect sets an inline height from
            // scrollHeight; on a responsive layout switch the textarea can be
            // measured with no layout (scrollHeight ≈ 0), leaving a stale ~few-px
            // inline height. min-height wins over height, so the field can never
            // collapse below a single row regardless of a bad measurement.
            minHeight: "2.25rem", // leading-5 (20px) + py-1.5 (12px) + border (2px)
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

  // Share the panel's infinite-query cache EXACTLY (same input + query type)
  // so the always-mounted badge and an open FloatingChatPanel resolve to ONE
  // query, not two. Previously this used a separate flat useQuery(limit:50);
  // TanStack keys an infinite query distinctly from a flat one, so whenever the
  // panel was open the same messages were fetched twice. We only read the
  // already-loaded pages here — pagination stays the panel's responsibility.
  const { data: crewData } = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "crew", limit: CHAT_PAGE_SIZE },
    {
      enabled: !!tripId,
      getNextPageParam: (lastPage) =>
        lastPage.length === CHAT_PAGE_SIZE
          ? lastPage[lastPage.length - 1].created_at
          : undefined,
    }
  );
  const { data: planningData } = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "planning", limit: CHAT_PAGE_SIZE },
    {
      enabled: !!tripId && canSeeOrganizers,
      getNextPageParam: (lastPage) =>
        lastPage.length === CHAT_PAGE_SIZE
          ? lastPage[lastPage.length - 1].created_at
          : undefined,
    }
  );
  const crewMessages = crewData?.pages.flat() ?? [];
  const planningMessages = planningData?.pages.flat() ?? [];

  // Server-backed read state (shared with FloatingChatPanel via the query
  // cache). markRead in the panel invalidates this query, so the badge reacts
  // the moment a channel is read — on this device or any other.
  const { data: readStateData } = trpc.messages.readState.useQuery(
    { tripId },
    { enabled: !!tripId }
  );
  const readMarks: Record<Visibility, string | null> = readStateData ?? {
    crew: null,
    planning: null,
  };

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
