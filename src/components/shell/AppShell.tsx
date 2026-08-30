"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { GameChromeProvider, useGameChrome } from "@/components/games/GameChrome";
import { useAppView, type AppView } from "./useAppView";
import { AppTabBar } from "./AppTabBar";
import { ContextIntro, LockedTabExplainer, type LockedExplainerView } from "./LockedTabExplainer";
import { ContextRail } from "./ContextRail";
import { ChatSheet } from "./ChatSheet";
import { ViewTabsPill } from "./ViewTabsPill";
import { useIsChatColumn } from "./breakpoints";
import { CONTENT_INSET, CONTENT_INSET_AT_GAME_DEPTH } from "./contentArea";
import { useCupPanel, isTwoPane } from "@/hooks/useCupPanel";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useMyTeamId } from "@/hooks/useMyTeamColor";
import { CHAT_SEGMENT_KEY } from "@/lib/chatSegments";

/**
 * AppShell — the persistent frame for the tab navigation (Phase 3), and,
 * since Phase 6, the chat overlay that layers on top of it.
 *
 * ── Scope, stated precisely: persistent WITHIN a context, not across ─────────
 * Trip ↔ Cup are free: same route, no server round trip, no remount —
 * the shell and both surfaces stay mounted and only the visible one
 * changes. **Home is a navigation**, because Home is context-free and lives on
 * `/dashboard` while the other two are scoped to `/trips/[tripId]`.
 *
 * That is a deliberate trade, not an oversight. Context switches are rare and
 * heavy by nature, and keeping them on a ROUTE boundary is what preserves the
 * anti-flash guarantee below. Don't read "no reload between tabs" as covering
 * Home — it doesn't, and it isn't meant to.
 *
 * ── Anti-flash: why a context switch stays a route change ────────────────────
 * Measured on the running app: with the trip page's 8-query gate DISABLED, a
 * trip switch still showed zero frames of trip A's content under trip B's
 * header, because `app/trips/[tripId]/loading.tsx` covers the navigation — Next
 * tears the segment down and rebuilds it. So the thing actually preventing the
 * bleed today is the ROUTE BOUNDARY, and the gate is belt-and-braces on top of
 * it. (Supporting: nothing in `src` uses `keepPreviousData`/`placeholderData`
 * and no surface mirrors a list query into local state, so a re-key yields
 * `undefined` rather than the previous trip's rows.)
 *
 * Keeping the context switch as a route change therefore keeps that guarantee
 * intact, which is what lets Phase 4 remove the gate without reintroducing the
 * bleed the gate was written for.
 */
export function AppShell({
  /** Current trip context, or null on the context-free host (`/dashboard`). */
  tripId,
  home,
  trip,
  cup,
  chat,
  /** Chrome the host renders above the tabs — the reduced top bar. */
  topBar,
  /** Landing tab when `?view=` is absent. `/…/leaderboard` passes "cup". */
  defaultView = "trip",
  remoteTripId = null,
  tripPlaced = true,
  tripHasCompetition = true,
}: {
  tripId: string | null;
  home?: ReactNode;
  /** Render prop so trip content can request a tab, or open chat (HomeTab's
   *  "open chat" card). A render prop rather than a context because exactly
   *  one consumer needs it. */
  trip?: ReactNode | ((api: { requestView: (v: AppView) => void; openChat: () => void }) => ReactNode);
  cup?: ReactNode;
  /** The Crew/Organizers/News content — a `<ChatView tripId canPost />`. Chat
   *  is an overlay now (Phase 6), not a view: this shell places it, via
   *  `ChatSheet` below the chat-column breakpoint or the plain `<aside>`
   *  at/above it — see `chatIsColumn` below. */
  chat?: ReactNode;
  /** Render prop so the top bar can wire up ITS OWN chat toggle (desktop,
   *  Phase 6) and Trip/Cup tabs (Task 4) — both are internal state this shell
   *  owns, same reasoning as `trip`'s render prop above: exactly one
   *  consumer (`TopNav`) needs them, and it has to come from here since
   *  `topBar` is otherwise constructed outside this component.
   *  `onToggleChat` TOGGLES rather than only opening — the desktop aside
   *  column has no close × of its own (unlike the mobile sheet's
   *  scrim/grip/back), so the same control that opens it is the only way to
   *  close it. `onDismissPanels` also closes chat, so opening the trip
   *  switcher / user menu doesn't leave chat's scrim trapping them.
   *  `activeView`/`onSelectView` are the SAME `select`/`activeForTabs`
   *  `AppTabBar` uses below — one tab-switching mechanism, two chrome
   *  consumers. No locked-tap callback: Trip/Cup are ABSENT with no context
   *  at `lg+` (Task 5), never dimmed-and-tappable-to-explain the way
   *  `AppTabBar`'s mobile tabs are — there's nothing for a tap to explain. */
  topBar?:
    | ReactNode
    | ((api: {
        chatOpen: boolean;
        onToggleChat: () => void;
        onDismissPanels: () => void;
      }) => ReactNode);
  defaultView?: AppView;
  /**
   * The context a REMOTE host should point at. Set on `/dashboard`, which is
   * context-free itself but knows which trip the user was last in.
   *
   * This is what makes Home read as "switch context" rather than "leave
   * context": arriving at Home with a trip behind you keeps Trip/Cup live
   * and pointing back at it, instead of greying them out. Tapping one navigates
   * to that trip's scoped host. Locked is then a true FIRST-RUN state — a brand
   * new account with no trips — rather than a mode you re-enter every time you
   * glance at your trip list.
   */
  remoteTripId?: string | null;
  /** The trip has a locked destination. False during the IDEA phase. */
  tripPlaced?: boolean;
  /** A competition row exists for this trip. */
  tripHasCompetition?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { view, setView } = useAppView(defaultView);
  const [peeking, setPeeking] = useState<LockedExplainerView | null>(null);
  const scoped = !!tripId;

  /**
   * ── Cup during the idea phase, and why the two surfaces differ ─────────────
   *
   * There is nothing to compete over until the trip has a destination, so Cup
   * has to say so. The two surfaces resolve that differently, on purpose.
   *
   * MOBILE — Cup is LOCKED, not hidden. It sits in a group of four alongside
   * Home and Chat, so a dimmed item has context, and someone who simply sees no
   * Cup never learns competitions exist or what they need. Locked-but-tappable
   * is the bar's existing idiom (see `AppTabBar`'s note) and it teaches both.
   *
   * DESKTOP — the whole tab group is ABSENT. Removing Cup there would leave a
   * lone Trip tab pointing at the screen you are already on, which is furniture
   * rather than a capability.
   *
   * This is NOT a new exception to disable-don't-hide. `TopNav` already hides the
   * entire group when there is no trip context at all — the rule is "hide the
   * group when it would be degenerate", and one tab is degenerate. Extending it
   * to the idea phase is that same rule, not a deviation from it.
   *
   * Desktop hides for a WIDER condition than mobile locks: also when the trip has
   * no competition. A Cup tab whose only content is a create-a-competition prompt
   * advertises a competition that does not exist. Mobile keeps Cup live in that
   * case — with a placed trip, creating one is a real thing to do and Cup is
   * where you do it, so it stays reachable where it has room.
   */
  const cupLockedReason = tripPlaced ? null : "A destination";
  const showDesktopTabs = scoped && tripPlaced && tripHasCompetition;

  /**
   * TWO different questions, each derived ONCE — because the two things that
   * must agree were previously derived separately and disagreed.
   *
   * `hasScopedContext` — is a trip actually open on THIS route? Drives the
   * desktop context tabs (Trip/Cup in `TopNav`) AND the `ContextIntro` "Pick a
   * trip to get started" explainer that replaces the content at `lg+`. Those two
   * are the same question and must never disagree: the explainer used to test
   * `!scoped` while the tabs tested `!hasContext` (below), so on `/dashboard`
   * for any user with at least one trip — `scoped` false, `remoteTripId`
   * populated — the explainer rendered AND Trip/Cup rendered beside it. #760's
   * Task 5 aimed at the wrong condition and so only hid them for a brand-new
   * zero-trip account. Same lesson as the scroll-ownership work: if two things
   * must agree, derive them once.
   *
   * `hasRemoteContext` — is there a trip worth POINTING AT, here or elsewhere?
   * Drives `AppTabBar`'s mobile locked-tab treatment only, where "the trip you
   * were just in" deliberately keeps Trip/Cup live and navigable so Home reads
   * as "switch context" rather than "leave context" (locked stays a true
   * first-run state). That remote-aware behaviour is correct on mobile, where
   * the tab bar is the only navigation — it is NOT correct for the desktop tabs,
   * because at `lg+` the rail is already the picker and the explainer already
   * carries the copy.
   */
  const hasScopedContext = scoped;
  const hasRemoteContext = scoped || !!remoteTripId;

  /**
   * Chat open/closed (Phase 6) — plain local state, not a view and not a URL
   * param. `ChatSheet` reuses `useModalBackButton` internally for the same
   * reason every other modal does: opening pushes one phantom history entry,
   * closing (X, scrim, or back) pops exactly that one, and none of it touches
   * `?view=` — chat is orthogonal to which tab is selected, which is the
   * whole point (see `useAppView`'s doc comment).
   */
  const [chatOpen, setChatOpen] = useState(false);
  const closeChat = useCallback(() => setChatOpen(false), []);
  /**
   * Opening chat on the context-free `/dashboard` host (`!scoped`) with a
   * `remoteTripId` behind it has to NAVIGATE, exactly like `select` does for
   * Trip/Cup — this host is never given a `chat` prop (there is no local
   * content to open an overlay around), so flipping `chatOpen` here would
   * pop a `ChatSheet` with nothing inside it. Toggling on the scoped host is
   * unaffected.
   */
  const openChat = useCallback(() => {
    if (!scoped && remoteTripId) {
      router.push(`/trips/${remoteTripId}`);
      return;
    }
    setChatOpen(true);
  }, [scoped, remoteTripId, router]);

  /**
   * `?chat=1[&channel=crew|planning]` — a notification's one-shot instruction
   * to open chat, consumed here and nowhere else.
   *
   * ── Why AppShell, and not the trip page ─────────────────────────────────
   * `chatOpen` and `openChat` are THIS component's state; nothing else can
   * open chat without going through them. Reading the param anywhere else
   * would mean threading a callback back out to wherever did the reading,
   * for no benefit — the shell already owns the router and the pathname.
   *
   * ── Why the segment goes through sessionStorage, not a new prop ─────────
   * `ChatView` already remembers the last-picked segment for the session via
   * `CHAT_SEGMENT_KEY` (`chatSegments.ts`) — the exact "which channel was I
   * on" question a notification is also answering. Writing that key here
   * reuses the mechanism `ChatView` already reads in its own mount-time
   * initializer, rather than inventing a second way to say the same thing.
   * The write happens BEFORE `openChat()` in the same synchronous effect body,
   * so it lands before `ChatView` mounts on the next render — after which its
   * initializer never re-reads the key, which is also this fix's one known
   * gap: retargeting chat via a SECOND notification for the other channel,
   * fired while chat is already open, opens the right room but does not
   * re-select the tab. Not handled here — it would need `ChatView` to accept
   * a live override rather than a mount-time seed, which is a larger change
   * than a query param deserves.
   *
   * ── Why this is a NEW shape (consume-then-strip) rather than the existing
   *    `?tab=`/`?view=` idiom ───────────────────────────────────────────────
   * Those are ADDRESSES — they belong in the URL for as long as you're on that
   * tab, so back/forward and sharing both work. `?chat=1` is an INSTRUCTION for
   * the next paint, not a place; leaving it in the URL would force chat open on
   * every reload and hand it to anyone the link is shared with. So it is
   * stripped via `router.replace` in the same tick rather than accumulated as
   * a sentinel — no history entry is created for it at all, which is also what
   * makes "reload doesn't reopen it" and "sharing after the tap doesn't carry
   * it" both true for free.
   *
   * ── `?tab=`/`?view=` survive the strip ──────────────────────────────────
   * Rebuilt from the CURRENT params with only `chat`/`channel` deleted — the
   * same shape `useAppView`'s `urlFor` uses — so a notification landing on
   * `?tab=comp&chat=1` still leaves `?tab=comp` in place afterwards.
   *
   * Guarded on `!!chat`: the context-free `/dashboard` host is never given a
   * `chat` prop (see its type doc), so a stray `?chat=1` there is inert rather
   * than opening a sheet with nothing inside it.
   */
  useEffect(() => {
    if (!chat) return;
    const requestedChannel = searchParams.get("channel");
    if (searchParams.get("chat") !== "1") return;

    if (requestedChannel === "crew" || requestedChannel === "planning") {
      try {
        window.sessionStorage.setItem(CHAT_SEGMENT_KEY, requestedChannel);
      } catch {
        // Private mode / storage disabled — chat still opens, just to
        // whichever segment was last remembered (or the default).
      }
    }
    openChat();

    const params = new URLSearchParams(searchParams.toString());
    params.delete("chat");
    params.delete("channel");
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    // `searchParams`/`pathname` are the only reactive inputs; `chat`/`openChat`
    // are stable across the render this fires in and re-including them would
    // not change when this can run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pathname]);
  const toggleChat = useCallback(() => {
    if (!scoped && remoteTripId) {
      router.push(`/trips/${remoteTripId}`);
      return;
    }
    setChatOpen((o) => !o);
  }, [scoped, remoteTripId, router]);

  /**
   * The one always-mounted holder of the chat realtime subscription, for the
   * whole scoped trip session (not just while chat is open) — mirrors what
   * useChatUnreadCount used to provide when the old TopNav Chat button lived
   * on this page. A prior refactor (the brief window Chat was a fourth
   * `AppView`) dropped `onOpenChat` from this page's TopNav call, which
   * silently took that subscription with it: nothing else on the trip page
   * called useRealtimeChat, so messages.list and the Chat action's unread dot
   * (useChatTabUnread) only ever updated on refetch/refocus, never live.
   * `onOpenChat`/`onToggleChat` is wired back in (Phase 6), but this stays
   * here regardless — chat can be closed while still needing a live unread
   * dot, so the subscription can't be scoped to "chat is open."
   *
   * Deliberately called HERE, not inside useChatTabUnread — that hook is
   * called independently from `AppTabBar` (always mounted, CSS-toggled by
   * breakpoint), so a subscription living there would double-subscribe to
   * the same `trip-chat:{tripId}` topic. AppShell is the one component
   * guaranteed to mount exactly once per scoped session.
   *
   * TEAM CHAT HAD NO EQUIVALENT, and it is what this paragraph's own rule —
   * "the subscription can't be scoped to 'chat is open'" — was written to
   * prevent, arriving anyway through a different door. Team's first realtime
   * subscription was added inside `FloatingChatPanelInner`, the panel
   * component itself — correct for keeping the OPEN team room live, wrong for
   * the unread dot, because `ChatSheet` unmounts every panel entirely when
   * chat closes (`if (!open) return null`). So the dot updated live only
   * while chat happened to be open on the Team tab, and sat stale — no live
   * update, no realtime-driven badge — the rest of the time. Reported live:
   * a team message landed with the recipient's chat panel closed and the
   * bottom-nav Chat dot never lit.
   */
  // `scoped` is `!!tripId` — `useMyTeamId(tripId)` already degrades to "no
  // team" for a null tripId on its own, so this reads as `tripId` plainly
  // rather than through a tautological ternary.
  const myTeamId = useMyTeamId(tripId);
  useRealtimeChat(tripId ?? "", "trip");
  useRealtimeChat(tripId ?? "", "team", myTeamId ?? undefined);

  /**
   * Chat's placement, independent of `effectiveView` (Phase 6): a persistent
   * 340px side column at/above the chat-column breakpoint, so the board stays
   * live while you talk, or a resizable bottom sheet below it. Never gated on
   * which tab is selected — see breakpoints.ts for why 1280 and not 1024, and
   * `ChatSheet`'s doc comment for why this is what removes the old tablet-width
   * dead zone rather than moving it.
   *
   * Computed here (ahead of `select`) so `select` can read `chatSheetOpen`
   * without a forward reference.
   */
  const chatIsColumn = useIsChatColumn();
  const chatAside = chatOpen && chatIsColumn;
  const chatSheetOpen = chatOpen && !chatIsColumn;

  const select = useCallback(
    (next: AppView) => {
      setPeeking(null);
      /**
       * Tapping a nav tab while the chat SHEET is open used to switch the tab
       * underneath and leave chat open over it — incoherent, since the scrim
       * already closes chat on an outside tap and the nav sits above the
       * scrim (the gap this closes). Scoped to `chatSheetOpen`, not `chatOpen`
       * outright: the persistent side column (`chatAside`, lg+) is a
       * deliberate "board stays live while you talk" layout, not a modal, and
       * switching tabs there must not close it.
       */
      if (chatSheetOpen) closeChat();
      // Home is context-free and lives on its own route — see the scope note.
      if (next === "home") {
        router.push("/dashboard");
        return;
      }
      // Context lives on another route (the dashboard host): navigate to it.
      if (!scoped && remoteTripId) {
        router.push(`/trips/${remoteTripId}?view=${next}`);
        return;
      }
      setView(next);
    },
    [router, setView, scoped, remoteTripId, chatSheetOpen, closeChat],
  );

  /**
   * `home` is not a valid view on a SCOPED route. Home is context-free and lives
   * on `/dashboard`, so `select("home")` navigates rather than setting `?view=`
   * — but a hand-written `/trips/X?view=home` still resolved to `"home"` here,
   * which hid both slots below (neither matches `effectiveView`) and rendered a
   * BLANK content area with nothing selected in the tab strip. Normalise it to
   * the host's landing tab instead of honouring an invalid state.
   */
  const effectiveView: AppView = scoped ? (view === "home" ? defaultView : view) : "home";

  /**
   * LAZY MOUNT, then keep. A slot is not mounted until its tab is first visited;
   * after that it stays mounted so returning to it is free.
   *
   * Eager-mounting all three was the obvious way to make switching instant, and
   * it worked — but it made every surface pay for surfaces nobody opened. Two
   * concrete costs:
   *
   *  - A cold `?view=cup` deep link fired the Trip slot's ~18 procedures for a
   *    tab the user never asked for.
   *  - `httpBatchLink` batches by tick, and a batch resolves at the speed of its
   *    SLOWEST member — so more mounted surfaces means more coupling between
   *    surfaces that have nothing to do with each other. That is what turned
   *    critical-path.spec.ts:309 red: it holds `games.configHash` for 20s, and
   *    the settings stepper waits on `games.getById`, its BATCH-MATE, not on the
   *    hash itself. Verified by capturing the live batch —
   *    `listOrganizers + getById + matches + scores + matchOutcomes + configHash`.
   *
   * So this is not a workaround for a test. Eager mount is a real egress and
   * latency cost, and lazy mount is the model regardless — it keeps the switch
   * free where it matters (anything already visited) and stops cold open paying
   * for the rest.
   */
  // Adjusted DURING render rather than in an effect. React supports this
  // explicitly ("adjusting state when props change"): the update is applied
  // before the browser paints, so the newly-visited slot mounts in the same
  // commit and there is no flash of an empty tab. An effect would paint once
  // without the slot and once with it; a ref would be an impure render read.
  // The set only ever grows, so this converges immediately.
  const [visited, setVisited] = useState<ReadonlySet<AppView>>(
    () => new Set<AppView>([effectiveView]),
  );
  if (!visited.has(effectiveView)) {
    setVisited(new Set(visited).add(effectiveView));
  }

  /**
   * Two-pane Cup → the panes own the scroll, not the body. The SAME predicate
   * `CompetitionFace` builds the grid from (`useCupPanel`), evaluated here off the
   * same React Query cache rather than re-derived — two derivations of "are we in
   * two-pane" is how the shell and the board silently disagree, and the disagreement
   * shows up as the double scrollbar this replaces.
   *
   * Gated on `effectiveView` too, not `panelOpen` alone: both tab slots stay mounted
   * and the inactive one is `hidden`, so a game left open while the user switches
   * to Trip keeps `panelOpen` true with the Cup hidden — switching the body to
   * `overflow-hidden` on `panelOpen` alone would leave the Trip tab unscrollable.
   *
   * `enabled` gates the underlying `games.listByTrip` fetch on the Cup having been
   * VISITED (#763). This hook runs on every trip page, but on the Trip tab with no
   * `?game=` nothing reads its result — `twoPane` is false on `effectiveView`
   * alone — so it was a cold-path request with no reader. Nothing is lost by
   * waiting: `useCupPanel` still fetches unconditionally when `?game=` is present
   * (a deep link into a panel), and once Cup opens, `LiveFaceClient` seeds this
   * very key from the server-resolved `faceBootstrap` (CLAUDE.md #10) — so the
   * warm path that made this prefetch look worthwhile already exists without it.
   *
   * Declared AFTER `visited` on purpose; it reads that set.
   */
  const { panelOpen } = useCupPanel(tripId, { enabled: visited.has("cup") });
  const twoPane = isTwoPane(panelOpen, effectiveView);

  /**
   * What the tab bars highlight while peeking a locked explainer. `peeking`
   * can be `"chat"` (the Chat action's own locked-tap explainer), which isn't
   * an `AppView` — Chat has no selected state to show in the first place, so
   * peeking it leaves the tab bars showing whatever was already active rather
   * than claiming a selection that doesn't exist.
   */
  const activeForTabs: AppView =
    peeking === "trip" || peeking === "cup" ? peeking : effectiveView;

  let body: ReactNode;
  if (peeking) {
    body = (
      <LockedTabExplainer
        view={peeking}
        onPickTrip={() => setPeeking(null)}
        // Only Cup carries a named prerequisite. Trip and Chat are locked by the
        // absence of a trip entirely, which the copy already covers and which no
        // "Requires:" line would improve.
        requires={peeking === "cup" ? cupLockedReason : null}
      />
    );
  } else if (!hasScopedContext) {
    /**
     * `/dashboard`. On MOBILE Home is a tab and the trip list is the body — that
     * is correct and unchanged. On DESKTOP the rail is the picker, so listing the
     * same trips again in the content area was the actual defect (nothing-selected
     * in the tab strip is the accurate state, not the bug). At `lg+` the content
     * area explains what the three context tabs scope to instead.
     *
     * Swapped by CSS on ONE tree — `lg:hidden` / `hidden lg:block` — not a JS
     * viewport branch, so crossing the breakpoint reflows and never remounts.
     * `home` stays mounted underneath at desktop, which costs nothing: the rail
     * and the dashboard share the `trips.list` query key, so React Query serves
     * both from one fetch.
     */
    body = (
      <>
        <div className="lg:hidden">{home}</div>
        <div className="hidden lg:block">
          <ContextIntro />
        </div>
      </>
    );
  } else {
    /**
     * All three scoped surfaces stay MOUNTED; only visibility changes. That is
     * what makes a tab switch free — no remount, no refetch, scroll preserved.
     *
     * `key={tripId}` is INERT TODAY and is documentation of intent, not active
     * defence: while the route boundary stands, each route instance only ever
     * sees ONE tripId, so the key never observes a change and never forces a
     * remount. It becomes load-bearing ONLY if the shell later collapses to a
     * single host where `tripId` changes underneath a mounted tree — at which
     * point it is the thing that stops trip A's content rendering under trip
     * B's header. Do not read it as protecting you before that change; do not
     * remove it while making that change.
     */
    /*
     * `lg:h-full lg:min-h-0` on these two wrappers is what makes the two-pane
     * panes able to scroll AT ALL. They carried no height, so `lg:h-full` on the
     * Cup grid below resolved to 100%-of-auto → auto, the grid grew with its
     * content, `items-stretch` stretched both panes to that content height, and
     * neither pane ever overflowed — the body absorbed everything instead. The
     * pane overflow rules were inert. Measured: body 782px, wrappers 671px auto.
     *
     * In ONE-pane this changes nothing visible: taller content simply overflows
     * these boxes visibly and the body (the scroller there) still scrolls it.
     */
    body = (
      <div key={tripId ?? "no-context"} className="lg:h-full lg:min-h-0">
        {visited.has("trip") && (
          <div hidden={effectiveView !== "trip"} className="lg:h-full lg:min-h-0">
            {typeof trip === "function" ? trip({ requestView: select, openChat }) : trip}
          </div>
        )}
        {visited.has("cup") && (
          <div hidden={effectiveView !== "cup"} className="lg:h-full lg:min-h-0">
            {cup}
          </div>
        )}
      </div>
    );
  }

  return (
    // The provider wraps the BAR as well as the content: TopNav reads
    // `useGameChrome()` to swap into game mode, so it must sit inside. Hoisting it
    // here is what lets the game panel (rendered deep inside the Cup tab) publish
    // its title/back/gear up to a bar the shell owns.
    <GameChromeProvider>
      {/**
       * ── The bounded full-height box, at `lg+` ONLY ────────────────────────
       * This root was `min-h-screen` — a FLOOR, not a height. That is the exact
       * diagnosis already made and fixed for mobile chat: with only a minimum,
       * no descendant can resolve a definite height, so every nested
       * `overflow-y-auto` is unbounded, nothing clips, and the PAGE scrolls
       * instead of the region. It is why the rail stopped at its content, why
       * `lg:items-stretch` stretched the rail to the CONTENT column rather than
       * the viewport (Crew being the tallest tab is the only reason any of it
       * looked right), and why the tab strip scrolled away.
       *
       * `lg:` ONLY is deliberate. Mobile is a page-scrolling document and is
       * CORRECT as it stands: `min-h-screen` is the right rule there, TopNav's
       * `sticky top-0` pins against the page scroll, `AppTabBar` is `fixed`, and
       * `ChatSheet` opts out entirely with a `fixed` bottom-pinned, percentage-height
       * box — a model arrived at only after `dvh` and then `svh` both failed
       * against Chrome's collapsing address bar (the lesson carried over from
       * when this was ChatView's own inline branch, pre-Phase-6). Making the
       * root a bounded viewport box on mobile would walk straight back into
       * that. Desktop has no dynamic toolbar and genuinely needs regions that
       * scroll independently of the document, so the bounded model is
       * ADDITIVE at `lg+`, not a correction of a shared rule.
       *
       * `h-dvh` over `h-screen`: nothing in the app currently establishes a
       * definite height at all (every rule is a `min-h-*` floor), so there is no
       * existing convention to match — and `dvh` is the honest unit.
       */}
      <div
        className="min-h-screen lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:overflow-hidden"
        style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
      >
        {/* Pinned by STRUCTURE at lg (a non-shrinking flex child of a bounded,
            overflow-hidden column) and by `sticky` below lg, where the PAGE is
            the scroller.
            The sticky has to live HERE, not only on the bar inside. A sticky
            element can only travel within its containing block, and this wrapper
            hugs the bar at exactly its own height (56px) — zero slack, so the bar
            rode the wrapper straight off screen at precisely the scroll offset
            (measured: scrollY 800 → the bar's rect.top −800, with
            `position: sticky` and `top: 0` both computing correctly the whole
            time). Putting it on the wrapper gives the sticky the SHELL as its
            containing block, which spans the scrollable content.
            `lg:static` hands the job back to the flex column at lg, so desktop
            keeps the structural pinning it already had. */}
        <TopBarSlot>
          {typeof topBar === "function"
            ? topBar({
                chatOpen,
                onToggleChat: toggleChat,
                onDismissPanels: closeChat,
              })
            : topBar}
        </TopBarSlot>
        {/* ONE tree, reflowed by CSS. The rail and AppTabBar are `hidden lg:*` /
            `lg:hidden`, so crossing a breakpoint changes which chrome paints —
            it never rebuilds the content beneath, which is what keeps scroll,
            mounted slots and in-flight state across a resize. Trip/Cup's OWN
            `lg:` chrome swap now lives inside `topBar` (TopNav), not as a
            second row here — see Task 4. */}
        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:items-stretch">
          <ContextRail activeTripId={tripId} />
          <div className="min-w-0 flex-1 lg:flex lg:min-h-0 lg:flex-col">
            {/*
             * The scroll BOUNDARY. `lg:min-h-0 lg:flex-1` gives this a resolved
             * height inside the bounded column; `lg:overflow-hidden` makes it a
             * clip box so the actual scrolling happens in the children below,
             * under the pinned strip — never on the document.
             *
             * Nothing is clipped by it that shouldn't be: every overlay on these
             * surfaces (player selector, discard prompt, sheets) is `createPortal`'d
             * to `document.body`, so it escapes this box entirely.
             */}
            {/*
             * The `lg:` here and `useIsChatColumn` MUST name the same width, and
             * now they do: `CHAT_COLUMN_PX === SHELL_DESKTOP_PX === 1024`, which
             * is Tailwind's `lg`. They were `xl:` and 1280 while the rail was
             * 1024, which left a 256px band where the whole desktop chrome was
             * showing but chat opened as a mobile bottom sheet.
             *
             * This is two sources for one threshold and it cannot be collapsed
             * into one — Tailwind needs a literal variant, the media query needs
             * a number. The mitigation is that the number is defined ONCE in
             * breakpoints.ts and this comment names the pair; if `lg` ever stops
             * meaning 1024, both move together.
             */}
            <ContentAreaBox chatAside={chatAside}>
              {/*
               * ── EXACTLY ONE SCROLLER PER VERTICAL CHAIN ────────────────────
               * One-pane → the body scrolls. Two-pane → the body does NOT; each
               * pane owns its own scroll. Never both.
               *
               * #749 left this unconditionally `overflow-y-auto`, which put two
               * scrollers in the game pane's chain (pane + body) and — worse —
               * meant the BOARD pane never scrolled at all: the body absorbed
               * everything, so the panes were never independent, and opening a
               * game while scrolled down put the pane below the fold because the
               * pane is a child of the thing that scrolled.
               *
               * `overflow-hidden` in two-pane makes "the body never scrolls here"
               * an INVARIANT rather than something that merely happens to hold
               * while the height chain below cooperates.
               */}
              {/*
               * `lg:max-w-[1280px]` with NO `mx-auto` — the content area is
               * LEFT-ALIGNED against the rail, capped so it doesn't stretch on
               * an ultrawide. The cap lives here, on the one box both Trip and
               * Cup render into, rather than being declared separately (and
               * differently) by each of them. See `contentArea.ts`.
               */}
              {/*
               * A POSITIONED wrapper around the scroller, so the view-tabs pill
               * can float over the content area without scrolling with it and
               * without centring across the chat column. It carries the height
               * chain (`lg:h-full lg:min-h-0`) rather than interrupting it —
               * this box sits between the grid and the scroller, and the panes
               * below depend on that chain resolving.
               */}
              <div className="relative min-w-0 lg:h-full lg:min-h-0">
                <div
                  className={`h-full min-w-0 lg:min-h-0 lg:max-w-[1280px] ${
                    twoPane ? "lg:overflow-hidden" : "lg:overflow-y-auto"
                  } ${showDesktopTabs ? "lg:pb-20" : ""}`}
                  data-testid="shell-body"
                >
                  {body}
                </div>
                {/* Bottom-centred on the CONTENT AREA. Absent (not dimmed) when
                    the group would be degenerate — same `showDesktopTabs`
                    condition the bar used, unchanged. */}
                {showDesktopTabs && (
                  <ViewTabsPill activeView={activeForTabs} onSelectView={select} />
                )}
              </div>
              {/* Chat's aside placement (Phase 6) — a persistent layout
                  region, not a floating dialog (no scrim), so it keeps the
                  Level-1 `--color-bt-card` token per STYLE_GUIDE §1. Below this
                  breakpoint chat renders as `ChatSheet` instead (below,
                  outside this grid — it's a `position: fixed` overlay, not a
                  layout participant). The two are mutually exclusive by
                  construction (`chatAside`/`chatSheetOpen` both derive from
                  the same `chatOpen && chatIsColumn` pair), so chat is never
                  mounted twice and never mounted nowhere while open. */}
              {chatAside && (
                <aside
                  className="min-w-0 rounded-xl lg:h-full lg:min-h-0 lg:overflow-hidden"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                    // Tells the panel's scroll fade which surface to start from.
                    // The surface choice lives HERE, with the container that owns
                    // it, rather than being guessed inside the panel.
                    ["--chat-surface" as string]: "var(--color-bt-card)",
                  } as React.CSSProperties}
                  data-testid="chat-column"
                >
                  {chat}
                </aside>
              )}
            </ContentAreaBox>
          </div>
        </div>
        <AppTabBar
          active={activeForTabs}
          // Remote-aware on purpose: on mobile the tab bar is the only
          // navigation, so "the trip you were just in" keeps Trip/Cup live and
          // navigable rather than greying them out. Mobile behaviour is
          // unchanged by the desktop fix above.
          hasContext={hasRemoteContext}
          // Locks Cup ALONE — a second lock reason beside "no trip at all".
          // Trip and Chat stay live during the idea phase: crew, destination
          // comparison and chat all work, and only competing doesn't.
          cupLockedReason={cupLockedReason}
          onSelect={select}
          onLockedTap={(v) => setPeeking(v)}
          chatOpen={chatOpen}
          onToggleChat={toggleChat}
          tripId={tripId}
        />
      </div>
      <ChatSheet open={chatSheetOpen} onClose={closeChat}>
        {chat}
      </ChatSheet>
    </GameChromeProvider>
  );
}

/**
 * The top bar's positioning wrapper — its own component so it can READ the game
 * chrome published from inside the provider `AppShell` itself renders. A
 * `useGameChrome()` call in AppShell's body would resolve against whatever
 * provider is ABOVE AppShell (none), not the one below it in its own JSX.
 *
 * ── Why it hides at all ──────────────────────────────────────────────────────
 * On a focused SCORE-ENTRY surface the bar is covered on mobile: keeping score
 * is a mis-tap-prone task that already owns the screen, and the bar puts targets
 * near the thumbs for no benefit. It costs no affordance — back · title ·
 * scorecard · settings live in `GameActionRow` inside the panel, not up here.
 * A game SCOREBOARD keeps both bars: chat matters mid-round precisely because it
 * reaches the other groups.
 *
 * `lg:block` is load-bearing. At `lg+` this bar carries the Trip/Cup tabs and the
 * chat toggle, which `GameActionRow` does NOT duplicate — hiding it there would
 * remove navigation, not noise. Desktop is untouched at every depth.
 *
 * Hidden by CSS rather than unmounted: the bar owns chat/news state and the
 * sticky containing block, and remounting it on every entry/exit would churn
 * both for a surface the user leaves constantly.
 */
function TopBarSlot({ children }: { children: React.ReactNode }) {
  const chrome = useGameChrome();
  return (
    <div
      className={`sticky top-0 z-40 lg:static lg:z-auto lg:shrink-0 ${
        chrome?.focusedEntry ? "hidden lg:block" : ""
      }`}
      style={{
        /**
         * The ONLY top safe-area inset in the app, and it exists because
         * `viewport-fit=cover` (root layout) lets content run under the status
         * bar / notch. Before that, `env()` resolved to 0 everywhere and this
         * would have been a no-op; after it, WITHOUT this the 56px bar sits
         * under the notch and its left content is unreadable on a notched phone.
         *
         * On the WRAPPER, not on `TopNav` itself: this is the sticky element, so
         * the padding has to be part of what sticks — padding inside the bar
         * would scroll its own background away from the inset region and leave a
         * gap at the top, which is the same class of artefact the cover fix is
         * removing.
         *
         * Padding rather than height, so the bar keeps its 56px and only the
         * inset is added — `--bt-bottomnav-height`'s counterpart at this end is
         * nothing that reads a top height, so there is no measurement to keep in
         * step.
         *
         * Background travels with it so the inset region is painted by the bar,
         * not by body — otherwise `cover` would simply move the band under the
         * status bar rather than remove it.
         */
        paddingTop: "env(safe-area-inset-top, 0px)",
        background: "var(--color-bt-nav-bg)",
      }}
      data-testid="top-bar-slot"
    >
      {children}
    </div>
  );
}

/**
 * The content area — its own component for the SAME reason `TopBarSlot` is one:
 * it has to READ the game chrome published from inside the provider `AppShell`
 * itself renders, and a `useGameChrome()` call in AppShell's body would resolve
 * against whatever provider is above AppShell (none).
 *
 * ── Why the inset is conditional ────────────────────────────────────────────
 * At game depth the top inset comes OFF, so the game's header row runs flush
 * under the app bar exactly as it does on mobile — where the panel is
 * `fixed top-14` and always did. Without this the desktop header sat 24px lower
 * than its mobile counterpart, leaving an empty band under the bar and redrawing
 * the header on a viewport change.
 *
 * It is done HERE, at the source, rather than by pulling the panel up from
 * below. Two shipped attempts did the latter and both rendered the game title
 * sliced in half (#938 on `GameActionRow`, inside an `overflow-y-auto` box;
 * #939 on the panel box, which then escaped `shell-body`'s `lg:overflow-hidden`).
 * A negative margin does not remove padding — it moves ONE box out of its
 * parent, and this subtree has two overflow-hidden ancestors, so there is no box
 * that can be pulled up without leaving one of them. Dropping the padding moves
 * the whole chain together and leaves nothing to clip.
 *
 * Only the TOP goes: horizontal and bottom insets are unchanged, so the row
 * lines up with the content beneath it and with the rail divider.
 */
function ContentAreaBox({
  chatAside,
  children,
}: {
  chatAside: boolean;
  children: React.ReactNode;
}) {
  const chrome = useGameChrome();
  return (
    <div
      className={`lg:min-h-0 lg:flex-1 lg:overflow-hidden ${
        chrome ? CONTENT_INSET_AT_GAME_DEPTH : CONTENT_INSET
      } ${chatAside ? "lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6" : ""}`}
      style={{ paddingBottom: "calc(var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px)) + 16px)" }}
      data-testid="content-area"
    >
      {children}
    </div>
  );
}
