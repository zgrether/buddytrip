"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Send, ChevronDown, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { invalidateChatQueries } from "@/lib/chatQueryInvalidation";
import { CHAT_VIEW_HEARTBEAT_MS } from "@/lib/chatViewHeartbeat";
import { readChatCache, writeChatCache, type CachedMessage } from "@/lib/chatCache";
import { readChatDraft, writeChatDraft } from "@/lib/chatDraft";
import { systemLineForViewer } from "@/lib/joinMessage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTripRole } from "@/hooks/useTripRole";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";

import { CHAT_FETCH_SIZE, dedupeById, olderCursor } from "@/components/chatPaging";

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
  //
  // SEEDED FROM LOCALSTORAGE, because this component unmounts on close
  // (`FloatingChatPanel` returns null when `isOpen` is false) and component
  // state goes with it — so closing the panel used to discard whatever was
  // typed. Read once in a lazy initializer, like the `seed` below: this is
  // localStorage, and re-reading per render would cost for no gain.
  const [drafts, setDrafts] = useState<Record<Visibility, string>>(() => ({
    crew: readChatDraft(tripId, "crew"),
    planning: readChatDraft(tripId, "planning"),
  }));
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
  //
  // ONE WRITE PATH. `setText` persists as it sets, so there is no second place
  // that has to remember to — including the `setText("")` in `handleSend`, which
  // is what clears a sent draft (an empty value removes the entry rather than
  // storing a blank one). A separate "save the draft" effect would be a second
  // list of moments to keep in step with this one, which is the shape that made
  // chat's invalidation bug (CLAUDE.md #22) take three sessions to find.
  const text = drafts[activeChannel];
  const setText = useCallback(
    (value: string) => {
      setDrafts((d) => ({ ...d, [activeChannel]: value }));
      writeChatDraft(tripId, activeChannel, value);
    },
    [tripId, activeChannel]
  );

  // Chat history is paginated, not loaded all at once: each page is the newest
  // PAGE_SIZE messages older than the previous page's cursor (server orders
  // created_at DESC and applies `.lt(created_at, cursor)`). Older history is
  // pulled in on demand as the viewer scrolls toward the top — so opening a
  // trip with 10k messages fetches 50 rows, not 10k. `olderCursor` derives the
  // next cursor and decides when the history is exhausted — see its note for why
  // that answer needs the over-fetched 51st row rather than a full-page guess.
  /**
   * SEED FROM LOCALSTORAGE so a cold open paints a conversation, not a skeleton.
   *
   * `initialData` supplies the cached page as page 0, and `initialDataUpdatedAt: 0`
   * marks it immediately stale so a background refetch ALWAYS fires. That pair is
   * the whole mechanism: `isLoading` is false (there is data, so no placeholder),
   * `isFetching` is true (so the quiet indicator shows), and the server's answer
   * replaces the cache the moment it lands.
   *
   * Read ONCE in a lazy initializer rather than on every render — this is
   * localStorage, and re-reading it per render would both cost and, worse, hand
   * React Query a fresh array identity every time.
   *
   * `undefined` (not `[]`) when there is no usable cache, because that is what
   * makes React Query treat the query as genuinely empty and show the loading
   * placeholder. A cached-but-discarded entry must never arrive as `[]`, which
   * would render as "no messages yet" — see `readChatCache`.
   */
  const [seed] = useState(() => ({
    crew: readChatCache(tripId, "crew"),
    planning: readChatCache(tripId, "planning"),
  }));
  const seedFor = (rows: CachedMessage[] | null) =>
    rows && rows.length > 0
      ? { initialData: { pages: [rows], pageParams: [undefined as string | undefined] }, initialDataUpdatedAt: 0 }
      : {};

  const crewQuery = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "crew", limit: CHAT_FETCH_SIZE },
    { getNextPageParam: olderCursor, ...seedFor(seed.crew) }
  );
  const planningQuery = trpc.messages.list.useInfiniteQuery(
    { tripId, channel: "trip", visibility: "planning", limit: CHAT_FETCH_SIZE },
    { enabled: canSeeOrganizers, getNextPageParam: olderCursor, ...seedFor(seed.planning) }
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

  /**
   * SERVER-CONFIRMED, per channel. `dataUpdatedAt > 0` means a real fetch has
   * resolved: the seed above is stamped 0 deliberately, so this is false while
   * the panel is showing cache alone and true once the server has answered.
   *
   * Two things hang off it, and both would be wrong without it — see the
   * markRead and heartbeat effects below.
   */
  const crewConfirmed = crewQuery.dataUpdatedAt > 0;
  const planningConfirmed = planningQuery.dataUpdatedAt > 0;

  // Persist the newest page back to localStorage. Only ever from CONFIRMED data:
  // re-writing the seed would be a no-op at best, and after a discarded-cache
  // read it would write back rows we just decided not to trust.
  useEffect(() => {
    if (crewConfirmed) writeChatCache(tripId, "crew", crewMessages as CachedMessage[]);
  }, [tripId, crewConfirmed, crewMessages]);
  useEffect(() => {
    if (planningConfirmed) writeChatCache(tripId, "planning", planningMessages as CachedMessage[]);
  }, [tripId, planningConfirmed, planningMessages]);

  const crewDisplayed = buildDisplayed(crewMessages as ChatMessage[], "crew");
  const planningDisplayed = buildDisplayed(planningMessages as ChatMessage[], "planning");
  const displayed = activeChannel === "crew" ? crewDisplayed : planningDisplayed;
  /** Has the ACTIVE channel been confirmed by the server this mount? */
  const confirmed = activeChannel === "crew" ? crewConfirmed : planningConfirmed;
  /**
   * Is what this device is showing still being kept up to date?
   *
   * "The most recent thing that happened to this query was a success" — a failed
   * background refetch leaves `errorUpdatedAt` ahead of `dataUpdatedAt`, which is
   * how a connectivity drop becomes visible to the heartbeat below. Confirmed
   * data alone is not enough: it stays true forever after one good fetch, which
   * is exactly the case that would keep stamping through an outage.
   */
  const activeChannelQuery = activeChannel === "crew" ? crewQuery : planningQuery;
  const viewIsCurrent =
    confirmed && activeChannelQuery.errorUpdatedAt <= activeChannelQuery.dataUpdatedAt;

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
  /** Last time EITHER path stamped the read mark — one clock shared by the
   *  message-arrival effect and the heartbeat, so they don't each write on
   *  their own schedule and double the traffic. */
  const heartbeatAtRef = useRef(0);
  useEffect(() => {
    /**
     * NOT UNTIL THE FETCH LANDS.
     *
     * `markRead` stamps the server's `now()`, which asserts "I have seen
     * everything up to this instant". Rendered from a cache that may be minutes
     * stale, that is simply false — it would clear the unread badge and the
     * new-messages divider for messages still in flight.
     *
     * It also protects #1058. `chat_reads.last_read_at` does DOUBLE DUTY: it is
     * the read position AND the recency-of-looking signal the push gate's
     * viewing window reads to decide whether someone is watching. Stamping on a
     * cached render would put a glance-and-close into the viewing window and
     * suppress their pushes for the next 2.5 minutes, having shown them nothing
     * new — the same bug #1058 fixed, arriving from the other side.
     *
     * Deferring costs nothing visible: the MESSAGES still paint instantly from
     * cache. Only the stamp waits.
     *
     * (The two roles agree today only because you always open onto the newest
     * messages. If offline read-marking is ever wanted, it needs its own column
     * rather than overloading this one — the overloading is what makes this
     * fragile.)
     */
    if (!confirmed) return;
    if (displayed.length === 0) return;
    const latest = displayed[displayed.length - 1];
    const ts = latest?.created_at;
    if (!ts) return;
    if (lastMarkedRef.current[activeChannel] === ts) return; // already marked
    lastMarkedRef.current[activeChannel] = ts;
    heartbeatAtRef.current = Date.now();
    markReadMutate({ tripId, visibility: activeChannel });
  }, [tripId, activeChannel, confirmed, displayed, markReadMutate]);

  // ── Viewing heartbeat — what makes "no push while you're looking" true ────
  //
  // The push gate (src/server/lib/chatNotify.ts) suppresses a recipient whose
  // read mark moved within CHAT_ACTIVE_VIEWING_WINDOW_MS, because that is the
  // ONLY server-visible evidence that someone is watching a channel. The effect
  // above advances that mark when a MESSAGE ARRIVES — which covers an active
  // conversation and misses a panel left open through a lull. Without this, a
  // message landing after ten quiet minutes would buzz at someone staring
  // straight at it.
  //
  // So an open panel re-stamps on an interval comfortably shorter than the
  // window (see chatViewHeartbeat.ts — the two constants are a pair, pinned by
  // a test). Deliberately cheap: it only does anything during QUIET periods,
  // since a live conversation already fires the effect above far more often,
  // and the guard below skips a beat that a real message already covered.
  //
  // GATED ON TAB VISIBILITY, not merely on the panel being mounted: a chat left
  // open in a background tab is not being viewed, and treating it as viewed
  // would silence notifications for someone who has genuinely walked away. On
  // hiding, the beats simply stop and they become notifiable again one window
  // later — no teardown bookkeeping needed.
  useEffect(() => {
    if (!tripId) return;
    const beat = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      /**
       * ONLY WHILE THE VIEW IS CURRENT.
       *
       * The heartbeat stamps `now()`, which claims the person has seen
       * everything up to this instant. That is true while the panel is open AND
       * the fetch is healthy. It stops being true the moment connectivity drops:
       * messages keep arriving server-side, this device cannot see them, and a
       * beat would mark them read anyway — clearing the unread badge and the
       * divider for messages that were never delivered.
       *
       * A pre-existing hole, introduced with the heartbeat itself in #1054 and
       * unnoticed until the cache work made "what is this device actually
       * looking at" a question worth asking. The condition is "the most recent
       * thing that happened to this query was a SUCCESS" — a failed background
       * refetch leaves `errorUpdatedAt` ahead of `dataUpdatedAt`, and the beat
       * simply stops until a fetch succeeds again.
       *
       * Consequence when it stops: the person drops out of the push viewing
       * window after ~2.5 min and becomes notifiable again. That is the right
       * way round — they are staring at a panel that is no longer being told
       * anything, so a push is exactly what they need.
       */
      if (!viewIsCurrent) return;
      const now = Date.now();
      // A real message-arrival mark within this interval already refreshed the
      // window, so don't spend a write re-proving it.
      if (now - heartbeatAtRef.current < CHAT_VIEW_HEARTBEAT_MS) return;
      heartbeatAtRef.current = now;
      markReadMutate({ tripId, visibility: activeChannel });
    };
    const id = setInterval(beat, CHAT_VIEW_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [tripId, activeChannel, viewIsCurrent, markReadMutate]);

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
      loading={activeQuery.isLoading}
      // Refreshing = we already have something on screen and are checking for
      // more. Distinct from `loading`, which means there is nothing to show yet;
      // conflating them is what would put a spinner over a readable conversation.
      refreshing={!activeQuery.isLoading && activeQuery.isFetching && !activeQuery.isFetchingNextPage}
      olderFailed={activeQuery.isFetchNextPageError}
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

/**
 * Reserved-height stand-in for the first page of history.
 *
 * Exists so the panel does not paint the "No messages yet" empty-state card
 * while the fetch is in flight and then swap it for 50 rows — a content swap
 * that reads as movement even though nothing scrolled. Bubble-shaped and
 * bottom-anchored (it is a child of the reversed scroll container), so the
 * real messages land in the same place these occupy.
 *
 * DELIBERATELY NOT ANIMATED — no pulse, no shimmer. The whole point of this
 * change is that opening chat is still; a throbbing placeholder would put the
 * motion back in a different costume. Matches the app's existing loading idiom
 * (`profile/page.tsx`): a plain reserved box on a surface token.
 *
 * Fixed widths, never random — a random width would differ between the server
 * and client renders.
 */
const PLACEHOLDER_ROWS: readonly { mine: boolean; width: string }[] = [
  { mine: false, width: "62%" },
  { mine: true, width: "45%" },
  { mine: false, width: "76%" },
  { mine: false, width: "38%" },
  { mine: true, width: "56%" },
  { mine: false, width: "67%" },
];

function ChatMessagesPlaceholder() {
  return (
    <div
      className="space-y-1.5 px-3 py-2"
      aria-hidden
      data-testid="chat-messages-placeholder"
    >
      {PLACEHOLDER_ROWS.map((row, i) => (
        <div
          key={i}
          className={`flex flex-col ${row.mine ? "items-end" : "items-start"}`}
        >
          {/* Stands in for the time + author line above each bubble. */}
          <div
            className="mb-0.5"
            style={{
              height: 12,
              width: 54,
              borderRadius: 3,
              background: "var(--color-bt-card-raised)",
              opacity: 0.55,
            }}
          />
          {/* Same geometry as a real bubble: rounded-2xl, ~34px tall. */}
          <div
            style={{
              height: 34,
              width: row.width,
              maxWidth: "85%",
              borderRadius: 16,
              background: "var(--color-bt-card-raised)",
            }}
          />
        </div>
      ))}
    </div>
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
  /** First page still in flight. Drives the reserved-height placeholder — WITHOUT
   *  it the empty-state card ("No messages yet") renders during the fetch and is
   *  then replaced by 50 rows, which is a second source of visible motion on a
   *  cold open, independent of scrolling. */
  loading: boolean;
  /** Content is already on screen and a background fetch is checking for more.
   *  A quiet line, never a spinner over the conversation — the whole point of
   *  the cache is that there is something to read while this is true. */
  refreshing: boolean;
  /** The last "load older" attempt failed — almost always offline. Said out
   *  loud, because a silent nothing is indistinguishable from "no more
   *  history", which is the exact empty-versus-unknown collapse this surface is
   *  careful about. */
  olderFailed: boolean;
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
  loading,
  refreshing,
  olderFailed,
}: ChatBodyProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Messenger-style jump-to-latest affordance. `isAtBottom` drives button
  // visibility (state so it re-renders as you scroll); `atBottomRef` mirrors it
  // for the new-message effect to read without re-subscribing. `hasNew`
  // emphasizes the button when messages land while you're scrolled up.
  const atBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  // One in-flight "load older" at a time. `loadingOlder` alone can't guard it:
  // a burst of scroll events all fire before React re-renders with
  // `isFetchingNextPage` true, so the flag is still false for several of them.
  const olderRequestedRef = useRef(false);
  useEffect(() => {
    if (!loadingOlder) olderRequestedRef.current = false;
  }, [loadingOlder]);

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

  // `instant` by DEFAULT, not `auto`. Per CSSOM-View, `auto` DEFERS to the
  // scrolled box's `scroll-behavior` CSS property — it is not a promise of no
  // animation. `globals.css` sets `html { scroll-behavior: smooth }`, and below
  // `lg` the document is the scroller, so `auto` is a live risk rather than a
  // theoretical one. `instant` is the value that actually guarantees no travel.
  //
  // `scrollIntoView` (not a `scrollTop` write) because this container is
  // `column-reverse`, where Chromium reports `scrollTop` in [-maxScroll, 0]
  // with 0 at the visual BOTTOM. `scrollIntoView` is agnostic to that
  // convention; arithmetic on `scrollTop` is not.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "instant") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    atBottomRef.current = true;
    setIsAtBottom(true);
    setHasNew(false);
  }, []);

  // Distances measured off two zero-height sentinels rather than off
  // `scrollTop`, for the reason above: under `column-reverse` the sign
  // convention is engine-specific (Chromium: 0 = bottom, negative upward;
  // other engines have historically used 0 = top), but the geometry never is.
  // Both distances below are non-negative and grow the way their names say in
  // every convention, so nothing here depends on which model the browser uses.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();

    const bottom = bottomRef.current;
    if (bottom) {
      const distanceFromBottom = bottom.getBoundingClientRect().top - box.bottom;
      const atBottom = distanceFromBottom < 80;
      atBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
      if (atBottom) setHasNew(false);
    }

    // Near the top — pull in the next page of older history. No anchor capture
    // and no post-prepend restore: `column-reverse` holds the scroll origin at
    // the bottom, so content arriving above the viewport does not move what
    // you are reading (measured: a 10-row prepend left the anchored message at
    // an unchanged offset). That used to be `pendingAnchorRef`'s job.
    const top = topRef.current;
    if (top && hasOlder && !loadingOlder && !olderRequestedRef.current) {
      const distanceFromTop = box.top - top.getBoundingClientRect().bottom;
      if (distanceFromTop < 120) {
        olderRequestedRef.current = true;
        onLoadOlder();
      }
    }
  }, [hasOlder, loadingOlder, onLoadOlder]);

  // React to changes in the message list.
  //
  // This used to own FOUR positioning jobs — open, channel switch, prepend and
  // append. Three of them are now the CONTAINER's job (`flex-col-reverse`, see
  // the JSX below), which is why they are gone from here rather than fixed
  // here: opening lands at the bottom on the first frame by construction, a
  // prepend does not move the viewport, and an append while you are pinned
  // keeps you pinned. All three were verified by measurement, not assumed.
  //
  // What remains is the one case that is genuinely a REACTION to data and not a
  // starting position: a message arrived while you were scrolled up. Your own
  // send pulls you back down (an animated, self-initiated scroll is correct
  // there); anyone else's just lights the pill and leaves you where you are.
  //
  // The old version classified the FIRST PAGE ARRIVING as an append-while-
  // pinned and therefore ran `scrollToBottom("smooth")` across 50 rows — that
  // animation was the visible travel on every cold open. It cannot recur here:
  // there is no code path left that scrolls in response to history loading.
  //
  // A plain effect, not `useLayoutEffect`. The layout phase existed to apply
  // the prepend anchor before paint; with no pre-paint DOM write left, the
  // honest phase is the passive one.
  const prevLenRef = useRef(0);
  const prevLastIdRef = useRef<string | null>(null);
  const prevChannelRef = useRef<string>("");
  useEffect(() => {
    const len = displayed.length;
    const lastId = len > 0 ? displayed[len - 1].id : null;

    // Channel switch: re-baseline only, so the first list we see on the new
    // channel is never mistaken for an append. No scroll — the container
    // already renders it at the bottom.
    if (prevChannelRef.current !== activeChannel) {
      prevChannelRef.current = activeChannel;
      prevLenRef.current = len;
      prevLastIdRef.current = lastId;
      return;
    }

    const grew = len > prevLenRef.current;
    const appended = grew && lastId !== prevLastIdRef.current;
    prevLenRef.current = len;
    prevLastIdRef.current = lastId;

    if (!appended) return; // prepend / refetch — the container holds position
    if (atBottomRef.current) return; // pinned — the container keeps us pinned

    // Both arms write state from an effect, which is the case the rule exists
    // to catch. It is the sanctioned exception here: the trigger is an external
    // system (a message arrived over realtime), not React state we already had.
    if (displayed[len - 1]?.user_id === currentUserId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- external data: your own send pulls you back down
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
        {/*
          * ── BOTTOM-ANCHORED BY CONSTRUCTION ──────────────────────────────
          * `flex-col-reverse` is what makes "the newest message is on screen"
          * true on the FIRST FRAME, with no effect, no measurement and no
          * scroll write. A reversed flex container puts its scroll origin at
          * the block-END, so the initial scroll position IS the bottom.
          *
          * This replaced an effect that scrolled to the bottom after the
          * messages arrived. The effect was not merely slow — it classified
          * the first page landing as "a new message arrived while you were
          * pinned" and animated (`behavior: "smooth"`) from the top of 50
          * rows, which is the travel this container removes. A correct effect
          * was one edge case away from being wrong again; a container cannot
          * be.
          *
          * DOM ORDER IS REVERSED, VISUAL ORDER IS NOT. Reversal applies only
          * to this element's DIRECT children, so the messages stay in one
          * normal-flow wrapper in chronological order — DOM order still
          * matches reading order, which is what keeps selection, copy/paste
          * and screen-reader order correct. Do NOT reverse the message array
          * to "match" the container.
          *
          * Direct children below are therefore listed BOTTOM-first.
          *
          * Three behaviours come free and are load-bearing (all measured in
          * Chromium before this was written, not assumed):
          *   • open / reveal → newest visible on the first layout, including
          *     when the panel is revealed after mounting `display: none`
          *     (the hidden Organizers segment — an effect could never have
          *     fixed that case, since a hidden box has no layout to scroll)
          *   • append while pinned → stays pinned
          *   • prepend (older history) → viewport does not move
          */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          data-testid="chat-scroll"
          // `overscroll-contain` stops the scroll CHAINING to the page behind
          // when this list reaches either end. Without it a flick at the top of
          // the history scrolls the trip page underneath, which also made the
          // sheet's drag-to-resize hard to land: the handle itself already
          // claims its gesture (`touchAction: "none"`, ChatSheet), so the
          // interference was coming from here, not from the handle.
          className="absolute inset-0 flex flex-col-reverse overflow-y-auto overflow-x-hidden overscroll-contain"
        >
          {/* Bottom-most. The scroll target for `scrollToBottom`, and the
              sentinel `handleScroll` measures distance-from-bottom against. */}
          <div ref={bottomRef} aria-hidden />
          {/* A quiet line, above the conversation, never over it. The cached
              messages are readable the whole time this is showing — which is
              the difference between "the app is fetching" and "the app is
              empty", and the reason a spinner would be the wrong control. */}
          {refreshing && displayed.length > 0 && (
            <div
              className="sticky top-0 z-10 flex justify-center py-1"
              style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
            >
              Checking for new messages…
            </div>
          )}
          {/* Said out loud rather than left as a silent nothing: on a golf
              course this is the one place the cache boundary becomes visible to
              a person, and "nothing happened" reads identically to "there is no
              more history". */}
          {olderFailed && (
            <div
              className="flex justify-center py-2 text-center"
              style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
            >
              Couldn&apos;t load earlier messages — check your connection.
            </div>
          )}
          {loading && <ChatMessagesPlaceholder />}
          {!loading && displayed.length > 0 && (
            <div className="space-y-1.5 px-3 py-2">
              {displayed.map((msg) => {
              // "New" divider — sits just above the first message that arrived
              // since you last read this channel. accent-colored hairline so it
              // reads as a soft boundary, not an alarm.
              const divider =
                msg.id === firstUnreadId ? (
                  <div className="flex items-center gap-2 py-1.5">
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
              //
              // ONE row, two readings (#982): a join line carries the joiner on
              // `user_id`, so the person it is about reads a welcome and everyone
              // else reads the notice. Writing two rows instead would double the
              // transcript and show everyone a greeting addressed to someone
              // else. The name is resolved HERE, from the live roster, so a
              // nickname change doesn't strand a stale name in the transcript.
              if (msg.message_type === "system") {
                const line = systemLineForViewer({
                  text: msg.text,
                  subjectUserId: msg.user_id,
                  viewerId: currentUserId,
                  subjectName: msg.user_id ? memberNames[msg.user_id] : null,
                });
                return (
                  <Fragment key={msg.id}>
                    {divider}
                    <div className="flex justify-center py-1">
                      <span
                        className="text-[10px] italic px-2 text-center"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        {line}
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
            </div>
          )}
          {/* Empty state — `m-auto` centers it in the flex container rather than
              letting it sit at the bottom where the messages would be. */}
          {!loading && displayed.length === 0 && (
            <div
              className="m-auto flex items-center justify-center text-center"
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
          {/* Sits ABOVE the list — it belongs to the older history being pulled
              in at the top, and under `flex-col-reverse` a later sibling is a
              higher one. */}
          {loadingOlder && (
            <p
              className="py-1 text-center text-[10px] italic"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Loading earlier messages…
            </p>
          )}
          {/* Top-most. Sentinel for the near-the-top "load older" trigger. */}
          <div ref={topRef} aria-hidden />
        </div>
        {/* The top fade. Lifted OUT of the scroll container (it was a `sticky`
            child with a `-mb-8` pull) — `sticky` inside a reversed flex
            container is a needless puzzle, and this never needed to scroll at
            all. Same gradient, now a plain overlay on the relative parent.

            The fade has to START from whatever surface it sits on, and this
            panel has TWO containers with deliberately different ones (#756):
            the scrimmed mobile sheet is `card-float`, the desktop aside is
            Level-1 `card` because it is a layout region, not a floating dialog.
            Hardcoding `card-float` was right for the sheet and visibly wrong in
            the aside — the gradient began a shade lighter than the panel behind
            it. Neither surface is the mistake; that was. The container declares
            `--chat-surface`; the sheet's default keeps its existing behaviour. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8"
          style={{ background: "linear-gradient(to bottom, var(--chat-surface, var(--color-bt-card-float)), transparent)" }}
        />
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
            // Contained for the same reason as the message list, and it matters
            // MORE here: a one- or two-line draft has nothing to scroll, so a
            // drag on the composer chains to the page immediately rather than
            // only at an end.
            overscrollBehavior: "contain",
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
