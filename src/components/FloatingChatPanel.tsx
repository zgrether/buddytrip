"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Send, ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { invalidateChatQueries } from "@/lib/chatQueryInvalidation";
import { CHAT_VIEW_HEARTBEAT_MS } from "@/lib/chatViewHeartbeat";
import { readChatCache, writeChatCache, type CachedMessage } from "@/lib/chatCache";
import { readChatDraft, writeChatDraft } from "@/lib/chatDraft";
import {
  readFailedOutbox,
  putFailedMessage,
  clearFailedMessage,
} from "@/lib/chatFailedOutbox";
import { systemLineForViewer } from "@/lib/joinMessage";
import {
  formatChatMessageTimestamp,
  formatChatDaySeparator,
  chatDayChanged,
} from "@/lib/chatTimestamp";
import { hasSeenChatBanner, markChatBannerSeen } from "@/lib/chatBannerCollapse";
import { SegmentedToggle } from "@/components/games/SegmentedToggle";
import {
  readChatTextSize,
  writeChatTextSize,
  chatPx,
  CHAT_BASE_PX,
  CHAT_TEXT_SIZES,
  type ChatTextSize,
} from "@/lib/chatTextSize";
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
  /**
   * The send failed and the message is held in the durable outbox.
   *
   * SEPARATE FROM `_optimistic` rather than a third value of it: a failed row
   * is still un-confirmed, so every rule that reads "not yet on the server"
   * keeps applying. What changes is only how it PRESENTS and what actions it
   * offers, which is a different question from what it is.
   */
  _failed?: boolean;
}

interface FloatingChatPanelProps {
  tripId: string;
  isOpen: boolean;
  /**
   * Is this the segment actually on screen?
   *
   * MOUNTED IS NOT VISIBLE. `ChatView` mounts the Crew and Organizers panels at
   * the same time and hides one with the `hidden` attribute, so each keeps its
   * own scroll position and composer. Both are therefore live components running
   * live effects, and two of those effects assert something about a person's
   * ATTENTION — "they have read this" and "they are looking at this" — which is
   * false for the hidden one.
   *
   * Observed in production: both channels' `viewing_at` written 2ms apart, which
   * no human can do. Opening Crew was marking Organizers as viewed, suppressing
   * its notifications, and marking it read.
   *
   * Defaults true so a caller that mounts exactly one panel needs to know
   * nothing about this.
   */
  active?: boolean;
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
  /**
   * The reading text size for the transcript (S/M/L, `chatTextSize.ts`) and
   * its setter — LIFTED to `ChatView`, the common ancestor of both mounted
   * panel instances (see `active` above: Crew and Organizers are both mounted
   * at once). Passed down rather than each instance reading its own
   * `localStorage` copy, because two independently-read copies would only
   * agree until the FIRST change: flip the size while looking at Crew, and an
   * Organizers instance that read its own copy on mount would keep showing
   * the old size until its next remount. One shared value means both panels
   * change together, instantly, which is what "one reading preference" means.
   *
   * Both optional with an internal fallback (see the inner component) so a
   * hypothetical future standalone caller — there is only one real caller
   * today, `ChatView` — still works, just without the cross-instance sync
   * guarantee above.
   */
  textSize?: ChatTextSize;
  onChangeTextSize?: (size: ChatTextSize) => void;
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
export function FloatingChatPanel({
  tripId,
  isOpen,
  active = true,
  ideaStage,
  channel,
  memberNames,
  textSize,
  onChangeTextSize,
}: FloatingChatPanelProps) {
  if (!isOpen) return null;
  return (
    <FloatingChatPanelInner
      tripId={tripId}
      active={active}
      ideaStage={ideaStage}
      channel={channel}
      memberNames={memberNames}
      textSize={textSize}
      onChangeTextSize={onChangeTextSize}
    />
  );
}

function FloatingChatPanelInner({
  tripId,
  active,
  ideaStage = false,
  channel,
  memberNames,
  textSize: textSizeProp,
  onChangeTextSize: onChangeTextSizeProp,
}: {
  tripId: string;
  active: boolean;
  ideaStage?: boolean;
  channel?: Visibility;
  memberNames: Record<string, string>;
  textSize?: ChatTextSize;
  onChangeTextSize?: (size: ChatTextSize) => void;
}) {
  const currentUser = useCurrentUser();
  const { role } = useTripRole(tripId);
  const canSeeOrganizers = role === "Owner" || role === "Organizer";
  // Internal fallback for the (today hypothetical) standalone caller — see the
  // prop's doc comment on `FloatingChatPanelProps`. `ChatView`, the one real
  // caller, always supplies both, so this branch is dead in practice; it
  // exists so the component degrades to "works, just unsynced" rather than
  // crashing if that ever stops being true.
  const [localTextSize, setLocalTextSize] = useState<ChatTextSize>(() => readChatTextSize());
  const textSize = textSizeProp ?? localTextSize;
  const setTextSize =
    onChangeTextSizeProp ??
    ((size: ChatTextSize) => {
      setLocalTextSize(size);
      writeChatTextSize(size);
    });
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
  /**
   * Un-confirmed messages: in flight, and — recovered from the durable outbox —
   * ones whose send FAILED in an earlier session.
   *
   * Seeded in a lazy initializer, which is possible only because the outbox
   * stores each message's author: a recovered bubble needs to know whose it is,
   * and the session read has not resolved at first paint. `buildDisplayed`
   * filters them to the signed-in account, so a leftover from another account
   * on a shared phone never renders.
   */
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>(() =>
    (["crew", "planning"] as const).flatMap((visibility) =>
      readFailedOutbox(tripId, visibility).map(
        (m): ChatMessage => ({
          id: m.id,
          trip_id: tripId,
          user_id: m.userId,
          channel: "trip",
          team_id: null,
          text: m.text,
          created_at: m.createdAt,
          visibility,
          message_type: "user",
          _optimistic: true,
          _failed: true,
        })
      )
    )
  );

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
        (m) =>
          m.visibility === visibility &&
          // The id dedup that retires an optimistic row once its real one
          // arrives — by realtime, by refetch, or from another device. It is
          // also what makes a RETRY safe to render: the retried message carries
          // the id it was sent with, so it replaces its own failed bubble
          // instead of appearing twice.
          !realIds.has(m.id) &&
          // A recovered failure belongs to whoever wrote it. Two accounts on one
          // phone share the outbox key, and attributing one's unsent message to
          // the other is worse than not recovering it at all.
          (!m._failed || m.user_id === currentUser?.id)
      );
      return real.slice().reverse().concat(pending);
    },
    [optimisticMessages, currentUser?.id]
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
  /**
   * The viewing heartbeat's write. Separate from `markRead` on purpose: it
   * touches `viewing_at` and nothing else, so a beat can never advance the read
   * position (migration 145).
   *
   * NO `onSuccess`, and that absence is the reason a 15s beat is affordable.
   * `markRead` invalidates three queries on success, so the old 60s beat cost one
   * write and three refetches. Nothing renders `viewing_at`, so there is nothing
   * to invalidate — a beat is one write.
   *
   * ── `meta.suppressErrorToast`, NOT an empty `onError` ──────────────────────
   * This shipped with `onError: () => {}`, which does NOT suppress anything:
   * React Query calls the MutationCache's `onError` as well as the mutation's,
   * and the cache-level one in `providers.tsx` is what shows the toast. So a
   * failing beat put a toast on screen every 15 seconds — observed in production
   * against a database missing `viewing_at`, but reachable any time the network
   * blips while a panel is open.
   *
   * `meta: { suppressErrorToast: true }` is the mechanism the cache handler
   * actually reads, and the one `useScoreSaver` and `useOutcomeSaver` already
   * use for the same reason: a write with no user-facing surface must not
   * announce its own failure.
   *
   * Suppressing is correct here rather than merely quiet. There is nothing for a
   * person to do about a missed beat, and the cost of missing one is at most a
   * notification they did not need. A toast would be an interruption reporting a
   * background timer.
   */
  const { mutate: markViewingMutate } = trpc.messages.markViewing.useMutation({
    meta: { suppressErrorToast: true },
  });
  const lastMarkedRef = useRef<Record<Visibility, string | null>>({
    crew: null,
    planning: null,
  });
  /** When the heartbeat last stamped `viewing_at`. Its own clock — the
   *  message-arrival mark writes a different column now and no longer stands in
   *  for a beat. */
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
     * ── The push half of this reasoning is GONE, and that is the good news ───
     * This used to say `last_read_at` does DOUBLE DUTY — read position AND the
     * recency-of-looking signal the push gate reads — so a stamp on a cached
     * render would suppress someone's pushes for minutes having shown them
     * nothing new. That was true and is no longer: migration 145 moved the
     * viewing signal to its own column, written only by the heartbeat. Marking
     * read cannot silence a notification any more, in any circumstance.
     *
     * The parenthetical that used to close this comment predicted the fix —
     * "if offline read-marking is ever wanted, it needs its own column rather
     * than overloading this one" — and the overloading is what got removed.
     *
     * What survives is the ORIGINAL reason, which never depended on push: a
     * stamp from a stale cache asserts "I have seen everything up to now" when
     * the device may be minutes behind, clearing the unread badge and the
     * new-messages divider for messages still in flight. Deferring costs nothing
     * visible — the MESSAGES still paint instantly from cache; only the stamp
     * waits.
     */
    // A HIDDEN SEGMENT HAS NOT BEEN READ. Both panels are mounted at once
    // (see `active`), and without this the Organizers panel marks itself read
    // whenever its messages load — while the person is looking at Crew. Its
    // unread badge would clear for messages nobody ever saw, which is the same
    // false claim this effect's `confirmed` guard exists to prevent, arriving
    // from a different direction.
    if (!active) return;
    if (!confirmed) return;
    if (displayed.length === 0) return;
    const latest = displayed[displayed.length - 1];
    const ts = latest?.created_at;
    if (!ts) return;
    if (lastMarkedRef.current[activeChannel] === ts) return; // already marked
    lastMarkedRef.current[activeChannel] = ts;
    markReadMutate({ tripId, visibility: activeChannel });
  }, [tripId, active, activeChannel, confirmed, displayed, markReadMutate]);

  // ── Viewing heartbeat — the ONLY suppression chat push has left ──────────
  //
  // The rule is now: notify on every message, unless you sent it or your panel
  // is open. There is no read-state gate and no re-arm — so this heartbeat is no
  // longer one input to a coalescing formula, it is the entire remaining logic.
  // A beat that fails to land is a notification someone gets while looking at
  // the screen; a beat that lands when it shouldn't is a message they never hear
  // about.
  //
  // It stamps `chat_reads.viewing_at` (migration 145) — NOT the read mark. The
  // heartbeat used to call `markRead`, which is how a panel open on a flaky
  // connection could mark messages read that the device had never received. It
  // cannot do that any more, because it no longer writes that column.
  //
  // Interval is comfortably shorter than the window (chatViewHeartbeat.ts — the
  // two constants are a pair, pinned by a test). Unlike the old one this does NOT
  // skip beats covered by a message arrival: those write a different column now
  // and prove nothing about `viewing_at`.
  //
  // GATED ON TAB VISIBILITY, not merely on the panel being mounted: a chat left
  // open in a background tab is not being viewed, and treating it as viewed
  // would silence notifications for someone who has genuinely walked away. On
  // hiding, the beats simply stop and they become notifiable again one window
  // later — no teardown bookkeeping needed.
  useEffect(() => {
    if (!tripId) return;
    // Not the segment on screen -> not being viewed. `document.visibilityState`
    // answers "is this TAB in front", which both mounted panels answer yes to.
    if (!active) return;
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
      if (now - heartbeatAtRef.current < CHAT_VIEW_HEARTBEAT_MS) return;
      heartbeatAtRef.current = now;
      markViewingMutate({ tripId, visibility: activeChannel });
    };
    // Beat IMMEDIATELY on mount as well as on the interval. `setInterval` alone
    // means the first stamp lands a full interval after the panel opens, so
    // someone who opens chat and a message that arrives in the next 15 seconds
    // would find them notified for a panel they are looking at. Cheap to fix and
    // invisible if it is missing, which is why it is called out.
    beat();
    const id = setInterval(beat, CHAT_VIEW_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [tripId, active, activeChannel, viewIsCurrent, markViewingMutate]);

  /**
   * Callbacks live in `postMessage` below, not here.
   *
   * Both outcomes need the message's `created_at` — the outbox stores it so a
   * recovered bubble keeps its place in the conversation — and `variables`
   * carries only what the ROUTER takes, which does not include it. Routing both
   * paths through one `mutateAsync` call site keeps the whole row in scope
   * instead of reconstructing it from a lookup on every settle.
   */
  const sendMessage = trpc.messages.send.useMutation();

  /**
   * The message already landed; this send was a retry that raced the truth.
   *
   * Read off the tRPC error CODE, which the router sets deliberately for the
   * unique-violation case (`messages.send`) — NOT off the message text, which
   * would make this depend on Postgres's wording.
   */
  const isAlreadySent = (err: unknown): boolean =>
    (err as { data?: { code?: string } })?.data?.code === "CONFLICT";

  /**
   * THE SINGLE SEND PATH — first attempt and retry alike.
   *
   * Retry re-uses the ORIGINAL id, which is what makes it safe: `messages.id`
   * is the primary key and the router inserts the client's id verbatim, so a
   * same-id retry cannot duplicate a message that already landed (the key
   * refuses it, and the router reports that as `CONFLICT`). Minting a fresh id
   * on retry is the one change here that would produce duplicates.
   */
  const postMessage = useCallback(
    async (
      msg: { id: string; text: string; createdAt: string; userId: string },
      visibility: Visibility
    ) => {
      // Un-mark first: a retry of a failed bubble should stop looking failed the
      // instant it is tapped, or the control appears not to have fired.
      setOptimisticMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, _failed: false } : m))
      );
      const settled = () => {
        clearFailedMessage(tripId, visibility, msg.id);
        // The SAME set the realtime INSERT handler invalidates — one shared
        // helper, because the delta between these two lists WAS the bug (see
        // chatQueryInvalidation.ts). Do not inline a key list here again.
        //
        // The refetch it triggers is also what RETIRES the optimistic row:
        // `buildDisplayed` drops any optimistic message whose id is in the real
        // set, and the real row carries the id we sent.
        invalidateChatQueries(utils, { tripId, channel: "trip", visibility });
      };
      try {
        await sendMessage.mutateAsync({
          tripId,
          id: msg.id,
          channel: "trip",
          visibility,
          text: msg.text,
        });
        settled();
      } catch (err) {
        // Already on the server — the same outcome as a success, reached the
        // long way round. Treating it as a failure would leave a retry button
        // on a message everyone else can already read.
        if (isAlreadySent(err)) {
          settled();
          return;
        }
        // CLAUDE.md #15: keep the value, flag the error, never roll back to
        // blank. The durable write happens HERE rather than in a state updater,
        // because updaters run twice under StrictMode.
        putFailedMessage(tripId, visibility, msg);
        setOptimisticMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, _failed: true } : m))
        );
      }
    },
    [tripId, utils, sendMessage]
  );

  /** Send it again, exactly as it was. */
  const retryMessage = useCallback(
    (msg: ChatMessage) => {
      if (!msg.user_id) return;
      void postMessage(
        { id: msg.id, text: msg.text, createdAt: msg.created_at, userId: msg.user_id },
        (msg.visibility ?? "crew") as Visibility
      );
    },
    [postMessage]
  );

  /** Give up on it: the bubble goes and nothing is sent. */
  const discardMessage = useCallback(
    (msg: ChatMessage) => {
      clearFailedMessage(tripId, (msg.visibility ?? "crew") as Visibility, msg.id);
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== msg.id));
    },
    [tripId]
  );


  // Plain function, not useCallback: React Compiler memoizes it automatically.
  // A manual dep array here conflicted with the compiler's inferred deps
  // ("existing memoization could not be preserved"), which made it bail on the
  // whole component. Letting the compiler own the memoization fixes that.
  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sendMessage.isPending || !currentUser?.id) return;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id,
        trip_id: tripId,
        user_id: currentUser.id,
        channel: "trip",
        team_id: null,
        text: trimmed,
        created_at: createdAt,
        visibility: activeChannel,
        message_type: "user",
        _optimistic: true,
      },
    ]);

    setText("");
    void postMessage(
      { id, text: trimmed, createdAt, userId: currentUser.id },
      activeChannel
    );
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

  /**
   * The channel explainer banner: collapsed to one tappable line after first
   * view (`chatBannerCollapse.ts`).
   *
   * ── Today this only applies to Organizers ───────────────────────────────
   * Crew has NO explainer banner in this codebase — grep confirms it; the
   * handoff describing "Crew has an equivalent banner, same treatment" does
   * not match what is actually here. Rather than invent Crew copy that has
   * never existed to satisfy that description, this is built channel-generic
   * (keyed by `activeChannel`, gated on `isPlanningChannel` only at the RENDER
   * site) — so the day a real Crew banner is written, collapsing it needs a
   * render-site change, not a change to this state or to `chatBannerCollapse`.
   *
   * ── Read fresh each render, not lazily ──────────────────────────────────
   * `isPlanningChannel` itself is computed fresh every render (see above), and
   * `activeChannel` can — rarely — change within one mounted instance (a
   * demotion mid-session falls an Organizers-channel instance back to "crew").
   * A lazy initializer would go stale exactly then; a plain read does not,
   * and the cost is one `localStorage.getItem` per render, which is cheap.
   *
   * `manualBannerToggle` is the EPHEMERAL per-mount override a tap sets — it
   * is not persisted (see `chatBannerCollapse.ts`'s header: only "has this
   * been shown once" is remembered, never "did they leave it open"). null
   * means "no override yet, use the default".
   */
  const [manualBannerToggle, setManualBannerToggle] = useState<boolean | null>(null);
  const bannerSeen = hasSeenChatBanner(tripId, activeChannel);
  const bannerExpanded = manualBannerToggle ?? !bannerSeen;
  useEffect(() => {
    if (isPlanningChannel && !bannerSeen) markChatBannerSeen(tripId, activeChannel);
    // Deliberately NOT resetting `manualBannerToggle` here: a channel switch
    // within one instance is the rare demotion case above, and there is no
    // wrong answer for what a stale manual toggle should mean across it.
  }, [tripId, activeChannel, isPlanningChannel, bannerSeen]);

  // Panel body — shared content between desktop + mobile wrappers. It MUST be
  // its own component (not inline JSX rendered twice) so each of the two
  // simultaneously-mounted wrappers gets independent scroll/textarea refs.
  const activeQuery = activeChannel === "crew" ? crewQuery : planningQuery;
  const body = (
    <ChatBody
      displayed={displayed}
      activeChannel={activeChannel}
      currentUserId={currentUser?.id}
      onRetryMessage={retryMessage}
      onDiscardMessage={discardMessage}
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
      bannerExpanded={bannerExpanded}
      onToggleBanner={() => setManualBannerToggle(!bannerExpanded)}
      textSize={textSize}
      onChangeTextSize={setTextSize}
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
  /** Re-send a failed message, reusing its original id (see `postMessage`). */
  onRetryMessage: (msg: ChatMessage) => void;
  /** Drop a failed message: the bubble goes and nothing is sent. */
  onDiscardMessage: (msg: ChatMessage) => void;
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
  /** Is the channel explainer banner currently showing its full form? Owned
   *  by the parent (see `FloatingChatPanelInner`'s banner-state block) —
   *  `ChatBody` only renders what it is told. */
  bannerExpanded: boolean;
  /** Tap the collapsed line, or the expanded block's own collapse control. */
  onToggleBanner: () => void;
  /** S/M/L — see `chatTextSize.ts`. Scales message text, timestamps, sender
   *  names and day-separator labels; leaves the composer untouched. */
  textSize: ChatTextSize;
  onChangeTextSize: (size: ChatTextSize) => void;
}

function ChatBody({
  displayed,
  activeChannel,
  currentUserId,
  onRetryMessage,
  onDiscardMessage,
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
  bannerExpanded,
  onToggleBanner,
  textSize,
  onChangeTextSize,
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
  /**
   * SHIELD THE MESSAGE LIST FROM `ScrollLock`'s TOUCH ARBITRATION.
   *
   * ── The bug ────────────────────────────────────────────────────────────────
   * Sitting at the newest message, the FIRST swipe toward older history does
   * nothing. Nudge the other way a few pixels and immediately reverse, and it
   * scrolls normally. Only at the bottom, and only when a scroll wasn't already
   * under way.
   *
   * ── Why ────────────────────────────────────────────────────────────────────
   * `react-remove-scroll` (via `ScrollLock`, wrapping the whole sheet) decides
   * per gesture whether a touch would scroll something it must block. It reads
   * the geometry in `handleScroll.js`:
   *
   *     elementScroll     = scrollHeight - clientHeight - directionFactor * scrollTop
   *     availableScrollTop += scrollTop
   *     // swipe toward older => negative delta =>
   *     if (!isDeltaPositive && Math.abs(availableScrollTop) < 1) cancel
   *
   * `directionFactor` is 1 unless the axis is HORIZONTAL and `direction: rtl` —
   * the library knows about RTL and knows nothing about `flex-direction:
   * column-reverse`. This list IS column-reverse, so `scrollTop` is 0 at the
   * VISUAL BOTTOM and goes negative toward older messages (the same convention
   * `scrollToBottom` below documents, and the reason it uses `scrollIntoView`
   * rather than arithmetic).
   *
   * So at the newest message `availableScrollTop` is 0, the library concludes
   * there is no room to scroll back, and `preventDefault()`s the move. The
   * two-step workaround works because once WebKit has handed a gesture to a
   * scroller, later `preventDefault()` calls are ignored for that gesture —
   * which is also why it only bites when a scroll wasn't already running.
   *
   * Pinned by `chatScrollLockBoundary.test.ts`, which asserts the library still
   * behaves this way. If that test ever fails, the library has learned about
   * column-reverse and this shield can go.
   *
   * ── Why stopping propagation is the right escape, not a workaround ─────────
   * The cancel happens in a BUBBLE-phase `touchmove` listener on `document`, so
   * stopping propagation at this container means the arbiter never sees moves
   * that start inside the list — and only those.
   *
   * `ScrollLock` keeps doing the job it was added for (#1055): a swipe on the
   * grip, the segment bar, the composer, the padding or the scrim still can't
   * scroll the page behind, because none of those are inside this element.
   * Containment for the list itself is `overscroll-behavior: contain` on the
   * container below — the platform mechanism for exactly this, already there,
   * and unlike the library's arithmetic it does not care which way the box is
   * laid out.
   *
   * Safe for React's delegation: nothing inside this subtree has a touch
   * handler (React attaches at the root container, above this element, so a
   * bubble-phase stop here would suppress them).
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Passive: this never calls preventDefault — it only keeps the event from
    // reaching an arbiter that would.
    const stop = (e: TouchEvent) => e.stopPropagation();
    el.addEventListener("touchmove", stop, { passive: true });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

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
      {/*
        HEADER STRIP — replaces what used to be ~90px of always-expanded
        explainer with a one-line summary plus the text-size control, both of
        which are cheap to render EVERY TIME (unlike the description below).

        Rendered for BOTH channels, deliberately, even though only Organizers
        has anything to summarize — see the comment on `bannerExpanded`'s
        `useState` above for why Crew has no equivalent line here despite an
        earlier description of this feature saying it does. The text-size
        control needs ONE home reachable from either channel, and giving Crew
        an empty left side (rather than omitting the strip on Crew and only
        having the control float on Organizers) keeps its position consistent
        regardless of which tab you're on.

        Neither side of this row scales with `textSize` — this is CHROME, and
        the whole reason §1 exists is that chrome doesn't scale while the
        setting it's about to gate grows, so scaling this row would eat back
        exactly the reading area it exists to free.
      */}
      <div
        className="flex flex-shrink-0 items-center gap-2 px-3 pb-1.5 pt-2"
        style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      >
        {isPlanningChannel ? (
          <button
            type="button"
            onClick={onToggleBanner}
            aria-expanded={bannerExpanded}
            data-testid="chat-banner-toggle"
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            <span
              className="truncate text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-accent)" }}
            >
              Organizers only
            </span>
            {/* The count survives into the collapsed line; the description
                does not — "In this chat: Brad, Rob, Zach" answers a question
                people actually have on repeat visits, where the description
                answers one they asked once. Hidden once expanded: the full
                membership list below already says the same thing at more
                length. */}
            {!bannerExpanded && organizers.length > 0 && (
              <span
                className="whitespace-nowrap text-[10px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                &middot; {organizers.length} in this chat
              </span>
            )}
            <ChevronRight
              size={12}
              style={{
                color: "var(--color-bt-text-dim)",
                flexShrink: 0,
                transform: bannerExpanded ? "rotate(90deg)" : "none",
                transition: "transform 120ms ease",
              }}
            />
          </button>
        ) : (
          // Crew: nothing to summarize (see above) — an empty flexible
          // spacer keeps the size control right-aligned exactly as it is on
          // Organizers, rather than the row visibly rearranging between tabs.
          <span className="min-w-0 flex-1" aria-hidden="true" />
        )}
        <SegmentedToggle<ChatTextSize>
          value={textSize}
          onChange={onChangeTextSize}
          options={CHAT_TEXT_SIZES.map((s) => ({ value: s, label: s }))}
          testId="chat-text-size"
        />
      </div>

      {/* The description + membership list — the part that's "useful once".
          Collapsed by default after first view (`chatBannerCollapse.ts`);
          the header strip above is what's ALWAYS there so collapsing this
          never loses "which channel am I in" — the tab row already answers
          that, and the collapsed line repeats it for anyone scrolled past
          the tabs. */}
      {isPlanningChannel && bannerExpanded && (
        <div className="flex-shrink-0 px-3 pt-2" data-testid="chat-banner-expanded">
          <div
            className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
            style={{
              background: "var(--color-bt-accent-faint)",
              border: "1px solid var(--color-bt-accent-border)",
              color: "var(--color-bt-text-dim)",
            }}
          >
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
              {displayed.map((msg, msgIndex) => {
              // Scaled pixel values for this size, computed once per row
              // rather than per scaled element — see `chatTextSize.ts`: ONE
              // ratio applied to every role, so a day separator and the
              // stamp beneath it can never visually disagree about the size
              // in effect.
              const messagePx = chatPx(CHAT_BASE_PX.message, textSize);
              const metaPx = chatPx(CHAT_BASE_PX.meta, textSize);
              const labelPx = chatPx(CHAT_BASE_PX.label, textSize);

              // DAY SEPARATOR — sits above the first message of a new calendar
              // day, compared against the PREVIOUS message in the transcript
              // (not against "now": a five-day-old transcript read today still
              // needs its own internal boundaries). System lines participate in
              // this comparison like any other message — a join notice at
              // 11:58 PM and the next real message at 12:02 AM are still a day
              // apart, and skipping system rows here would silently swallow
              // that boundary.
              const daySeparator = chatDayChanged(
                msg.created_at,
                msgIndex === 0 ? null : displayed[msgIndex - 1].created_at
              ) ? (
                <div className="flex items-center gap-2 py-1.5" data-testid="chat-day-separator">
                  <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
                  <span
                    className="font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-bt-text-dim)", fontSize: labelPx }}
                  >
                    {formatChatDaySeparator(msg.created_at)}
                  </span>
                  <div className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
                </div>
              ) : null;

              // "New" divider — sits just above the first message that arrived
              // since you last read this channel. accent-colored hairline so it
              // reads as a soft boundary, not an alarm. Rendered BELOW the day
              // separator when both land on the same message: the day is the
              // bigger-picture landmark, "New" is the more immediate one, and
              // that order reads top-down as "which day, then which message".
              const divider =
                msg.id === firstUnreadId ? (
                  <div className="flex items-center gap-2 py-1.5">
                    <div className="h-px flex-1" style={{ background: accentBorder }} />
                    <span
                      className="font-semibold uppercase tracking-wider"
                      style={{ color: accentVar, fontSize: labelPx }}
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
                    {daySeparator}
                    {divider}
                    <div className="flex justify-center py-1">
                      <span
                        className="italic px-2 text-center"
                        style={{ color: "var(--color-bt-text-dim)", fontSize: metaPx }}
                      >
                        {line}
                      </span>
                    </div>
                  </Fragment>
                );
              }

              const isMe = msg.user_id === currentUserId;
              // Day-aware: time-only for today, "Yesterday 3:42 PM" / "Tue
              // 3:42 PM" / "Aug 19 3:42 PM" once it isn't (chatTimestamp.ts).
              // Same rule the day separator above uses, so the two can never
              // disagree about what day a message falls on.
              const time = formatChatMessageTimestamp(msg.created_at);
              return (
                <Fragment key={msg.id}>
                  {daySeparator}
                  {divider}
                  <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-1.5 px-1 mb-0.5">
                      <span style={{ color: "var(--color-bt-text-dim)", fontSize: metaPx }}>
                        {time}
                      </span>
                      {!isMe && (
                        <span
                          className="font-medium"
                          style={{ color: "var(--color-bt-text-dim)", fontSize: metaPx }}
                        >
                          {msg.user_id ? memberNames[msg.user_id] ?? "Unknown" : "Unknown"}
                        </span>
                      )}
                    </div>
                    <div
                      className="max-w-[85%] rounded-2xl px-3 py-1.5 whitespace-pre-wrap break-words"
                      style={{
                        background: isMe ? accentFaint : "var(--color-bt-card-raised)",
                        /* A failed message is BORDERED in danger rather than
                           filled: it is still your message and still readable,
                           and a red block reads as an error the app produced
                           rather than as a message waiting to be sent. */
                        border: `1px solid ${
                          msg._failed
                            ? "var(--color-bt-danger)"
                            : isMe
                              ? accentBorder
                              : "var(--color-bt-border)"
                        }`,
                        color: "var(--color-bt-text)",
                        /* Dimmed while IN FLIGHT only. A failed message is not
                           in flight and must not fade into the backdrop — it is
                           the one bubble here that needs to be noticed. */
                        opacity: msg._optimistic && !msg._failed ? 0.6 : 1,
                        // Scales with the reading-size control (chatTextSize.ts)
                        // — the whole reason this bubble's own text-sm class
                        // was removed. S resolves to exactly 14px, same as
                        // the class it replaced.
                        fontSize: messagePx,
                      }}
                    >
                      {msg.text}
                    </div>
                    {/*
                      NOT SENT — said plainly, with both ways out.

                      The state is worthless if it is not noticed (a silently
                      marked bubble is barely better than losing the message), so
                      this is words rather than a colour cue alone: a border
                      change is invisible to anyone not looking for it, and this
                      arrives exactly when attention is elsewhere.

                      Retry first and Discard second, in that order: retry is
                      what almost everyone wants, and discard is irreversible.
                    */}
                    {msg._failed && (
                      <div
                        className="mt-1 flex items-center gap-2 px-1"
                        data-testid="chat-failed-actions"
                      >
                        <span
                          className="font-medium"
                          style={{ color: "var(--color-bt-danger)", fontSize: metaPx }}
                        >
                          Not sent
                        </span>
                        <button
                          type="button"
                          onClick={() => onRetryMessage(msg)}
                          className="font-medium underline underline-offset-2"
                          style={{ color: "var(--color-bt-text)", fontSize: metaPx }}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => onDiscardMessage(msg)}
                          className="underline underline-offset-2"
                          style={{ color: "var(--color-bt-text-dim)", fontSize: metaPx }}
                        >
                          Discard
                        </button>
                      </div>
                    )}
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

      {/* Input.
          Padding bumped from py-2 (reported: the send button sat too close to
          the bottom tab bar's own chat toggle — on mobile, `ChatSheet` pins its
          `bottom` to the top of that bar (`--bt-bottomnav-height`), so this
          row's own padding is the ONLY separation between the two chat
          controls. py-3 gives that gap room without touching the sheet's own
          positioning. */}
      <div
        className="flex items-end gap-2 px-3 py-3"
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
          // 28px (h-7) was BOTH a hit-target complaint and the cause of the
          // "offset down" one: the row is `items-end`, so a button shorter
          // than the textarea's own 2.25rem min-height bottom-aligns with a
          // gap left ABOVE it, reading as sitting low relative to the field's
          // text. Matching the textarea's `minHeight: "2.25rem"` EXACTLY (h-9
          // = 2.25rem) makes the two identical in height at the single-line
          // rest state, so there is no gap to misread as an offset — and it
          // is bigger to tap. `items-end` stays: once the textarea grows past
          // one line, the button pins to the bottom-most line rather than
          // floating at the vertical center of a multi-line box.
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-30"
          style={{ background: accentVar, color: "var(--color-bt-base)" }}
          aria-label="Send message"
        >
          <Send size={15} />
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
