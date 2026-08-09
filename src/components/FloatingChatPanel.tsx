"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Send, ChevronDown, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { invalidateChatQueries } from "@/lib/chatQueryInvalidation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTripRole } from "@/hooks/useTripRole";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";

// Chat history page size — how many messages each lazy "load older" fetch pulls.
export const CHAT_PAGE_SIZE = 50;

/**
 * What we actually ASK the server for: one more than a page.
 *
 * The extra row is a has-more SIGNAL, not content. Asking for exactly
 * `CHAT_PAGE_SIZE` makes "is there older history?" unanswerable at the boundary:
 * a full page means either "exactly this many exist" or "more exist", and the
 * old `length === CHAT_PAGE_SIZE` test guessed the second. A channel with
 * exactly 50 messages therefore reported more history and spent a fetch proving
 * otherwise — and 50 is, as it happens, the size of the largest real channel in
 * production, so this was the common case rather than a corner.
 *
 * Asking for 51 makes the test exact: >50 rows back means at least one message
 * exists beyond the page, full stop.
 */
export const CHAT_FETCH_SIZE = CHAT_PAGE_SIZE + 1;

/**
 * Cursor for the next (older) page, or `undefined` when the history is exhausted.
 *
 * The cursor is the 50th row's timestamp — the last row of the PAGE, not of the
 * over-fetched response. The 51st row is therefore re-fetched as the first row of
 * the next page, which is why the flattened list is de-duplicated by id below.
 * Paying one duplicated row per page is what buys an exact has-more answer.
 */
export const olderCursor = (lastPage: { created_at: string }[]): string | undefined =>
  lastPage.length > CHAT_PAGE_SIZE ? lastPage[CHAT_PAGE_SIZE - 1].created_at : undefined;

/** First occurrence wins — the pages are newest-first, so that keeps the copy
 *  from the newer page and drops the overlapped one from the older page. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

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
  /**
   * Drive the channel from OUTSIDE (the shell's Chat segments own the choice).
   * The panel has no channel-tab UI of its own (#758 removed it along with the
   * standalone chrome it belonged to) — this prop is the only way a channel
   * gets picked.
   *
   * It is still a REQUEST, not a grant: the derivation below refuses "planning"
   * for anyone who isn't currently an organizer, so this cannot be used to reach
   * a channel the caller can't read.
   */
  channel?: Visibility;
  memberNames: Record<string, string>;
}

/**
 * FloatingChatPanel — the trip chat surface. Renders as a SEGMENT of
 * `ChatView` (normal flow, filling whatever height the caller gives it) — the
 * standalone docked-rail/bottom-sheet chrome this used to share with News is
 * gone (#758); `ChatSheet` is the one surface that owns sizing now.
 *
 * Two sub-channels live behind a tab toggle (Owner/Organizer only see the
 * toggle — everyone else just gets Crew):
 *   - Crew       — every trip member (messages.visibility = 'crew')
 *   - Organizers — Owner + Organizer only (messages.visibility = 'planning')
 *
 * Open state is owned by the page; this component only renders + reads.
 */
export function FloatingChatPanel({ tripId, isOpen, ideaStage, channel, memberNames }: FloatingChatPanelProps) {
  if (!isOpen) return null;
  return (
    <FloatingChatPanelInner
      tripId={tripId}
      ideaStage={ideaStage}
      channel={channel}
      memberNames={memberNames}
    />
  );
}

function FloatingChatPanelInner({
  tripId,
  ideaStage = false,
  channel,
  memberNames,
}: {
  tripId: string;
  ideaStage?: boolean;
  channel?: Visibility;
  memberNames: Record<string, string>;
}) {
  const currentUser = useCurrentUser();
  const { role } = useTripRole(tripId);
  const canSeeOrganizers = role === "Owner" || role === "Organizer";
  // IDEA stage collapses to a single Organizers channel: every member is an
  // Owner/Organizer, so the Crew channel would just duplicate it. The tab
  // toggle is hidden and the channel is pinned to 'planning'.
  const ideaSolo = ideaStage && canSeeOrganizers;

  const utils = trpc.useUtils();
  // Drafts are kept per channel so an unsent message stays with the tab it was
  // typed in. Switching tabs swaps the visible draft; hitting Enter only ever
  // sends the draft that belongs to the channel you're currently looking at.
  const [drafts, setDrafts] = useState<Record<Visibility, string>>({ crew: "", planning: "" });
  const [selectedChannel] = useState<Visibility>("crew");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);

  // Derived, not stored: non-organizers can never resolve to the planning
  // channel even if they were demoted mid-session with the panel open. The
  // external `channel` prop goes through the SAME guard, so the shell's segments
  // cannot grant access the role doesn't. `canSeeOrganizers` comes from
  // useTripRole -> tripMembers.list, which useRealtimeMembers invalidates on any
  // trip_members change — so a promotion or demotion re-derives live, with no
  // remount.
  const activeChannel: Visibility = ideaSolo
    ? "planning"
    : canSeeOrganizers
      ? (channel ?? selectedChannel)
      : "crew";

  // The visible draft + writer for the active channel.
  const text = drafts[activeChannel];
  const setText = useCallback(
    (value: string) => setDrafts((d) => ({ ...d, [activeChannel]: value })),
    [activeChannel]
  );

  // Chat history is paginated, not loaded all at once: each page is the newest
  // PAGE_SIZE messages older than the previous page's cursor (server orders
  // created_at DESC and applies `.lt(created_at, cursor)`). Older history is
  // pulled in on demand as the viewer scrolls toward the top — so opening a
  // trip with 10k messages fetches 50 rows, not 10k. `olderCursor` derives the
  // next cursor and decides when the history is exhausted — see its note for why
  // that answer needs the over-fetched 51st row rather than a full-page guess.
  const crewQuery = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "crew", limit: CHAT_FETCH_SIZE },
    { getNextPageParam: olderCursor }
  );
  const planningQuery = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "planning", limit: CHAT_FETCH_SIZE },
    { enabled: canSeeOrganizers, getNextPageParam: olderCursor }
  );

  // Pages come back newest-first within each page and progressively older across
  // pages, so the flattened list is fully created_at DESC. buildDisplayed
  // reverses it to chronological order for rendering.
  //
  // De-duplicated by id, which the over-fetch makes load-bearing rather than
  // defensive: consecutive pages OVERLAP by exactly one row (see `olderCursor`),
  // so without this every page boundary would render a repeated message. It also
  // absorbs the realtime prepend racing a refetch that already carried the row.
  // Keeps the FIRST occurrence, so the newest copy wins.
  const crewMessages = useMemo(
    () => dedupeById((crewQuery.data?.pages.flat() ?? []) as ChatMessage[]),
    [crewQuery.data]
  );
  const planningMessages = useMemo(
    () => dedupeById((planningQuery.data?.pages.flat() ?? []) as ChatMessage[]),
    [planningQuery.data]
  );

  // Roster of the people who can see the Organizers channel — Owner + Planners
  // who are actually on the trip. Powers the explainer at the top of that tab.
  const { data: allMembers = [] } = trpc.tripMembers.list.useQuery(
    { tripId },
    { ...STRUCTURE_QUERY, enabled: canSeeOrganizers }
  );
  const organizers = allMembers.filter(
    (m) => (m.role === "Owner" || m.role === "Organizer") && m.status === "in"
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
  // No `data` destructured — this call's job is the subscription itself:
  // it's what populates the `messages.readState` cache the lazy initializer
  // below reads via `getData`, and what `markReadMutate`'s invalidate()
  // refetches on the next read-tracking cycle.
  trpc.messages.readState.useQuery({ tripId }, { enabled: !!tripId });

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

  // Mark the active channel read whenever it's shown and new messages arrive.
  // markRead stamps the server clock; on success it invalidates readState
  // (refreshing the cache the next mount's dividerSnapshots reads) AND
  // unreadCount (F3 — the badge in useChatUnreadCount no longer shares a query
  // with this panel, so it needs its own explicit invalidation to clear on
  // read). The readState refresh produces a fresh `displayed` reference which
  // would re-trigger this effect, so we track the last-marked newest-message
  // timestamp in a ref and only fire when it actually changes (per channel) —
  // no mutation loop.
  const { mutate: markReadMutate } = trpc.messages.markRead.useMutation({
    onSuccess: () => {
      utils.messages.readState.invalidate({ tripId });
      utils.messages.unreadCount.invalidate({ tripId });
      // ...and the per-segment breakdown, which was MISSING: the Chat tab's
      // Crew/Planning dots read `unreadCountByChannel`, so reading a segment
      // cleared the combined badge while its own dot stayed lit until the next
      // refetch. Same invalidation-set divergence as the send/realtime split —
      // both counts are fed by one server function and must clear together.
      utils.messages.unreadCountByChannel.invalidate({ tripId });
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

  const sendMessage = trpc.messages.send.useMutation({
    onSuccess: (_, variables) => {
      // The SAME set the realtime INSERT handler invalidates — one shared
      // helper, because the delta between these two lists WAS the bug (see
      // chatQueryInvalidation.ts). Do not inline a key list here again.
      invalidateChatQueries(utils, {
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

  // Always renders this way now — normal flow, no scrim, no drag-resize, no
  // close ×, no tab toggle (a segment has nothing to close or resize itself;
  // you leave by choosing another segment, and the container around
  // `ChatView` owns whatever height this gets). The standalone docked-rail/
  // bottom-sheet chrome this used to share with News (#758) is gone — the
  // only caller left is this same segment. The notify toggle lives in
  // ChatView's own segment row (inline with Crew/Organizers/News) — it's a
  // single per-account preference, not per-channel, so it doesn't belong to
  // any one panel instance.
  return <div className="flex h-full min-h-0 flex-col">{body}</div>;
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
      scrollToBottom("smooth");
    } else {
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
            // The fade has to START from whatever surface it sits on, and this
            // panel has TWO containers with deliberately different ones (#756):
            // the scrimmed mobile sheet is `card-float`, the desktop aside is
            // Level-1 `card` because it is a layout region, not a floating dialog.
            // Hardcoding `card-float` was right for the sheet and visibly wrong in
            // the aside — the gradient began a shade lighter than the panel behind
            // it. Neither surface is the mistake; this was. The container declares
            // `--chat-surface`; the sheet's default keeps its existing behaviour.
            style={{ background: "linear-gradient(to bottom, var(--chat-surface, var(--color-bt-card-float)), transparent)" }}
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
 * (Crew always; Organizers when Owner/Organizer). Server-computed
 * (messages.unreadCount, F3) instead of derived from a fetched messages page —
 * this hook no longer pulls message rows at all with the panel closed.
 *
 * The query's OWN options match news.unreadCount exactly (no override —
 * global defaults: staleTime 60s, no refetchInterval): same query-key
 * policy, per queryConfig.ts's F4 lesson, not a second one invented for this
 * badge. But unlike news, this query also gets INVALIDATED by the realtime
 * subscription already mounted below (useRealtimeChat.ts) — a deliberate,
 * one-directional divergence, not drift back toward the pre-F3 client
 * derivation. Reason: news lagging until the next focus/remount is an
 * acceptable tradeoff; chat isn't. Live trash talk mid-round is a stated
 * product feature, and a chat badge that visibly trails the messages it's
 * counting reads as broken in a way a quiet news badge doesn't. No polling
 * was added to get this — the invalidation rides the subscription the panel
 * already requires (see the comment on that hook call, below).
 */
export function useChatUnreadCount(tripId: string): number {
  // Subscribe to realtime here — safe to do even though `AppShell` also holds a
  // trip-chat subscription. The channel is REF-COUNTED per topic
  // (`useRealtimeChat`'s `acquire`), so both mounts share one join and either can
  // unmount without killing the survivor. Subscribing from more than one place is
  // now correct by construction rather than forbidden by convention.
  //
  // This comment previously claimed the opposite — that ChatToolButton only
  // mounted on the competition Live face and never on the four-tab trip page, and
  // that a second subscriber would be a "duplicate-topic collision." Both halves
  // stopped being true when #756 wired `onOpenChat` into the trip page's TopNav:
  // ChatToolButton mounted there (at every width — `hidden lg:block` is CSS, not
  // a mount gate), creating exactly the second subscription this text said didn't
  // exist. That is the third time in three shell restructures that chat realtime
  // broke because "what is always mounted" moved underneath a comment describing
  // it. The ref-count is the fix; this note is a warning about the class of bug,
  // not a new invariant to maintain by hand.
  useRealtimeChat(tripId, "trip");

  const { data } = trpc.messages.unreadCount.useQuery(
    { tripId },
    { enabled: !!tripId }
  );
  return data ?? 0;
}
