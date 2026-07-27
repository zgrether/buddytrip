"use client";

import { useEffect, useRef } from "react";
import { pushMarker, isOwnPop } from "@/lib/historyMarker";

/**
 * useScreenHistory — sync a linear in-page "screen stack" with browser history, so
 * the OS/browser BACK button steps back through in-page screens instead of leaving
 * the page (the score-entry surfaces used `useState` screens that pushed no history,
 * so device-back skipped straight to the leaderboard). Generalizes the pushState +
 * popstate pattern `useGameSettingsOverlay` uses for the settings overlay.
 *
 * Contract (the page must follow both halves):
 *  - **FORWARD** (open a deeper screen) → update state so `depth` GROWS. The hook
 *    pushes one history entry per new level.
 *  - **BACKWARD** (breadcrumb, finish, cell-tap-to-entry — anything that closes a
 *    screen) → call the returned `back()`, NEVER reduce `depth` directly. `back()`
 *    does `history.back()`, whose popstate calls `onBack()` (which the page uses to
 *    pop exactly ONE level). This makes the in-page arrow and the OS back identical.
 *
 * `onBack` must pop exactly one level of the page's own screen state. `depth` is the
 * current number of sub-screens open (0 = the root/scoreboard).
 */
export function useScreenHistory(depth: number, onBack: () => void) {
  const pushed = useRef(0);
  // The depth each pushed level claimed, so a popstate can be tested for
  // ownership (historyMarker.ts). Parallel to `pushed.current`, which stays the
  // count of levels we own.
  const claimed = useRef<number[]>([]);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  // Grow: one sentinel per newly-opened level so a back press has something to pop.
  // (A shrink is always popstate-driven — history is already popped there — so we
  // only re-sync the counter down, never push/pop here.)
  useEffect(() => {
    while (pushed.current < depth) {
      claimed.current.push(pushMarker("screen", { btScreen: pushed.current + 1 }));
      pushed.current += 1;
    }
    if (pushed.current > depth) {
      pushed.current = depth;
      claimed.current.length = depth;
    }
  }, [depth]);

  // OS/browser back (or our own back()) pops one level.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (pushed.current <= 0) return;
      // Not our entry — a layer ABOVE us was popped (a modal, the settings
      // overlay, the game panel, or the tab sentinel). Pass it through to whoever
      // owns it instead of eating a screen level that is still on screen.
      if (!isOwnPop(e, claimed.current[claimed.current.length - 1] ?? 0)) return;
      pushed.current -= 1;
      claimed.current.pop();
      onBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Breadcrumb / programmatic back — route through history so it's identical to the
  // OS back (popstate → onBack). Direct fallback if nothing was pushed.
  return () => {
    if (pushed.current > 0) window.history.back();
    else onBackRef.current();
  };
}
