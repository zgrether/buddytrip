"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GameChromeProvider } from "@/components/games/GameChrome";
import { useAppView, type AppView } from "./useAppView";
import { AppTabBar } from "./AppTabBar";
import { ContextIntro, LockedTabExplainer, type LockedExplainerView } from "./LockedTabExplainer";
import { ContextRail } from "./ContextRail";
import { ChatSheet } from "./ChatSheet";
import { useIsChatColumn } from "./breakpoints";
import { useCupPanel, isTwoPane } from "@/hooks/useCupPanel";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";

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
   *  `activeView`/`onSelectView`/`onLockedTapView` are the SAME `select`/
   *  `activeForTabs`/`setPeeking` `AppTabBar` uses below — one tab-switching
   *  mechanism, two chrome consumers. */
  topBar?:
    | ReactNode
    | ((api: {
        chatOpen: boolean;
        onToggleChat: () => void;
        onDismissPanels: () => void;
        activeView: AppView;
        hasContext: boolean;
        onSelectView: (v: AppView) => void;
        onLockedTapView: (v: LockedExplainerView) => void;
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
}) {
  const router = useRouter();
  const { view, setView } = useAppView(defaultView);
  const [peeking, setPeeking] = useState<LockedExplainerView | null>(null);
  const scoped = !!tripId;
  const hasContext = scoped || !!remoteTripId;

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
   */
  useRealtimeChat(tripId ?? "", "trip");

  const select = useCallback(
    (next: AppView) => {
      setPeeking(null);
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
    [router, setView, scoped, remoteTripId],
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
   * Chat's placement, independent of `effectiveView` (Phase 6): a persistent
   * 340px side column at/above the chat-column breakpoint, so the board stays
   * live while you talk, or a resizable bottom sheet below it. Never gated on
   * which tab is selected — see breakpoints.ts for why 1280 and not 1024, and
   * `ChatSheet`'s doc comment for why this is what removes the old tablet-width
   * dead zone rather than moving it.
   */
  const chatIsColumn = useIsChatColumn();
  const chatAside = chatOpen && chatIsColumn;
  const chatSheetOpen = chatOpen && !chatIsColumn;

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
   */
  const { panelOpen } = useCupPanel(tripId);
  const twoPane = isTwoPane(panelOpen, effectiveView);

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
    body = <LockedTabExplainer view={peeking} onPickTrip={() => setPeeking(null)} />;
  } else if (!scoped) {
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
        {/* Pinned by STRUCTURE at lg (a non-shrinking flex child of a bounded
            column) rather than by `sticky`, which is what it still relies on for
            the mobile page scroll. Both work; neither fights the other. */}
        <div className="lg:shrink-0">
          {typeof topBar === "function"
            ? topBar({
                chatOpen,
                onToggleChat: toggleChat,
                onDismissPanels: closeChat,
                activeView: activeForTabs,
                hasContext,
                onSelectView: select,
                onLockedTapView: (v) => setPeeking(v),
              })
            : topBar}
        </div>
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
            <div
              className={`lg:min-h-0 lg:flex-1 lg:overflow-hidden ${
                chatAside ? "xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-4 xl:p-4" : ""
              }`}
              style={{ paddingBottom: "calc(var(--bt-bottomnav-height, 0px) + 16px)" }}
            >
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
              <div
                className={`min-w-0 lg:h-full lg:min-h-0 ${
                  twoPane ? "lg:overflow-hidden" : "lg:overflow-y-auto"
                }`}
                data-testid="shell-body"
              >
                {body}
              </div>
              {/* Chat's aside placement, ≥1280 (Phase 6) — a persistent layout
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
                  }}
                  data-testid="chat-column"
                >
                  {chat}
                </aside>
              )}
            </div>
          </div>
        </div>
        <AppTabBar
          active={activeForTabs}
          hasContext={hasContext}
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
