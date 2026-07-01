"use client";

import { useEffect, useRef } from "react";

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
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  // Grow: one sentinel per newly-opened level so a back press has something to pop.
  // (A shrink is always popstate-driven — history is already popped there — so we
  // only re-sync the counter down, never push/pop here.)
  useEffect(() => {
    while (pushed.current < depth) {
      window.history.pushState({ btScreen: pushed.current + 1 }, "");
      pushed.current += 1;
    }
    if (pushed.current > depth) pushed.current = depth;
  }, [depth]);

  // OS/browser back (or our own back()) pops one level.
  useEffect(() => {
    const onPop = () => {
      if (pushed.current > 0) {
        pushed.current -= 1;
        onBackRef.current();
      }
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
