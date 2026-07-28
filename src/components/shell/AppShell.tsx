"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GameChromeProvider } from "@/components/games/GameChrome";
import { useAppView, type AppView } from "./useAppView";
import { AppTabBar } from "./AppTabBar";
import { LockedTabExplainer } from "./LockedTabExplainer";
import { ContextRail } from "./ContextRail";
import { DesktopTabStrip } from "./DesktopTabStrip";
import { useIsChatColumn } from "./breakpoints";

/**
 * AppShell — the persistent frame for the four-tab navigation (Phase 3).
 *
 * ── Scope, stated precisely: persistent WITHIN a context, not across ─────────
 * Trip ↔ Cup ↔ Chat are free: same route, no server round trip, no remount —
 * the shell and all three surfaces stay mounted and only the visible one
 * changes. **Home is a navigation**, because Home is context-free and lives on
 * `/dashboard` while the other three are scoped to `/trips/[tripId]`.
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
  /** Render prop so trip content can request a tab (HomeTab's "open chat" card
   *  used to open an overlay; now it selects the Chat tab). A render prop rather
   *  than a context because exactly one consumer needs it. */
  trip?: ReactNode | ((api: { requestView: (v: AppView) => void }) => ReactNode);
  cup?: ReactNode;
  chat?: ReactNode;
  topBar?: ReactNode;
  defaultView?: AppView;
  /**
   * The context a REMOTE host should point at. Set on `/dashboard`, which is
   * context-free itself but knows which trip the user was last in.
   *
   * This is what makes Home read as "switch context" rather than "leave
   * context": arriving at Home with a trip behind you keeps Trip/Cup/Chat live
   * and pointing back at it, instead of greying them out. Tapping one navigates
   * to that trip's scoped host. Locked is then a true FIRST-RUN state — a brand
   * new account with no trips — rather than a mode you re-enter every time you
   * glance at your trip list.
   */
  remoteTripId?: string | null;
}) {
  const router = useRouter();
  const { view, setView } = useAppView(defaultView);
  const [peeking, setPeeking] = useState<Exclude<AppView, "home"> | null>(null);
  const scoped = !!tripId;
  const hasContext = scoped || !!remoteTripId;

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

  const effectiveView: AppView = scoped ? view : "home";

  /**
   * On a wide desktop, Chat does not REPLACE the content — it sits beside it in a
   * 340px column, so the board stays live while you talk (which is what the old
   * floating panel was working around). The main column therefore has to keep
   * showing something: the last non-Chat view you were on.
   *
   * Below the chat breakpoint, Chat is a full-width tab as on mobile, and this is
   * unused. See breakpoints.ts for why 1280 and not 1024.
   */
  const chatIsColumn = useIsChatColumn();
  const [lastContentView, setLastContentView] = useState<Exclude<AppView, "home" | "chat">>("trip");
  if (effectiveView !== "chat" && effectiveView !== "home" && effectiveView !== lastContentView) {
    setLastContentView(effectiveView as Exclude<AppView, "home" | "chat">);
  }
  /** What the MAIN column renders. Chat-as-column keeps the content behind it. */
  const mainView: AppView =
    chatIsColumn && effectiveView === "chat" ? lastContentView : effectiveView;
  const chatAside = chatIsColumn && effectiveView === "chat";

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

  let body: ReactNode;
  if (peeking) {
    body = <LockedTabExplainer view={peeking} onPickTrip={() => setPeeking(null)} />;
  } else if (!scoped) {
    body = home;
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
    body = (
      <div key={tripId ?? "no-context"}>
        {visited.has("trip") && (
          <div hidden={mainView !== "trip"}>
            {typeof trip === "function" ? trip({ requestView: select }) : trip}
          </div>
        )}
        {visited.has("cup") && <div hidden={mainView !== "cup"}>{cup}</div>}
        {/*
         * Chat is CONDITIONALLY RENDERED, not hidden like the other two.
         *
         * `FloatingChatPanel` and `NewsPanel` render through `createPortal`, so
         * they are not DOM children of this wrapper — `hidden` sets display:none
         * here and the portal keeps painting. Their desktop rail is
         * `fixed inset-x-0 top-14 bottom-0 z-50`, so an "invisible" Chat tab sat
         * over the whole app and swallowed every click. That is not a subtle
         * failure: it broke four merge-blocking E2E specs, all reporting the same
         * `intercepts pointer events`.
         *
         * Mounting on demand costs Chat a remount per visit. Acceptable — it is
         * still no route change, the message pages are already warm from the
         * unread-count query (DATA_FRESHNESS_AUDIT F3), and correctness beats a
         * warm cache. Trip and Cup are not portaled, so they keep staying mounted,
         * which is where the win actually matters.
         */}
        {/* Chat renders inline only when it OWNS the view. As a side column it is
            rendered by the layout below instead, so it never appears twice. */}
        {effectiveView === "chat" && !chatAside && chat}
      </div>
    );
  }

  return (
    // The provider wraps the BAR as well as the content: TopNav reads
    // `useGameChrome()` to swap into game mode, so it must sit inside. Hoisting it
    // here is what lets the game panel (rendered deep inside the Cup tab) publish
    // its title/back/gear up to a bar the shell owns.
    <GameChromeProvider>
      <div
        className="min-h-screen"
        style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
      >
        {topBar}
        {/* ONE tree, reflowed by CSS. The rail and the two tab chromes are
            `hidden lg:*` / `lg:hidden`, so crossing a breakpoint changes which
            chrome paints — it never rebuilds the content beneath, which is what
            keeps scroll, mounted slots and in-flight state across a resize. */}
        <div className="lg:flex lg:items-stretch">
          <ContextRail activeTripId={tripId} />
          <div className="min-w-0 flex-1">
            <DesktopTabStrip
              active={peeking ?? effectiveView}
              hasContext={hasContext}
              onSelect={select}
              onLockedTap={(v) => setPeeking(v)}
            />
            <div
              className={chatAside ? "xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-4 xl:p-4" : ""}
              style={{ paddingBottom: "calc(var(--bt-bottomnav-height, 0px) + 16px)" }}
            >
              <div className="min-w-0">{body}</div>
              {chatAside && (
                <aside
                  className="min-w-0 rounded-xl"
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
          active={peeking ?? effectiveView}
          hasContext={hasContext}
          onSelect={select}
          onLockedTap={(v) => setPeeking(v as Exclude<AppView, "home">)}
        />
      </div>
    </GameChromeProvider>
  );
}
