"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

/**
 * GameChrome — a tiny context so a game view can publish its bar chrome (title +
 * the owner/delegate settings gear + the scorecard affordance + a hide-bottom-nav
 * flag) UP to the shared app bar (TopNav), instead of rendering its own second
 * header on the panel (the double-decker #550 removes). The bar's BACK is always
 * `history.back()` — the game views' existing popstate listeners (useScreenHistory
 * for score/grid, useGameSettingsOverlay for config, router.back for the panel)
 * make that correct at every level, so no per-screen back handler is published
 * (Phase 0 finding).
 *
 * Provider presence ALSO tells a game view it's hosted as a PANEL (under TopNav)
 * vs. on its own standalone route (no TopNav): `useInGamePanel()`. In a panel the
 * view suppresses its own header and publishes here; on a standalone route (no
 * provider) it keeps rendering its header as before, so deep-links don't lose
 * their chrome.
 *
 * Two contexts on purpose: the VALUE (re-renders TopNav) and the SETTER (stable,
 * so a publisher's effect doesn't loop when the value changes).
 */
export interface GameChromeData {
  /** Single-line game title shown in the bar (NO format subtitle — dropped). */
  title: string;
  /** Owner/delegate-only settings gear. Present ⇒ the bar shows it. The VIEW
   *  gates on `useGameEditAccess`, so a member simply never passes it. */
  onSettings?: () => void;
  /** Opens the scorecard overlay (the entry surface's Table2 affordance, moved
   *  into the bar when the entry header is removed). Present ⇒ the bar shows it. */
  onScorecard?: () => void;
  /** Hide the trip bottom nav (#550 Task 5) — true on the focused SCORE-ENTRY
   *  surface (exit is the app-bar back), false on the scoreboard (a viewing
   *  surface where trip nav stays useful). */
  hideBottomNav?: boolean;
}

type SetChrome = (c: GameChromeData | null) => void;

const ChromeValueCtx = createContext<GameChromeData | null>(null);
const SetChromeCtx = createContext<SetChrome | null>(null);

export function GameChromeProvider({ children }: { children: React.ReactNode }) {
  const [chrome, setChrome] = useState<GameChromeData | null>(null);
  return (
    <SetChromeCtx.Provider value={setChrome}>
      <ChromeValueCtx.Provider value={chrome}>{children}</ChromeValueCtx.Provider>
    </SetChromeCtx.Provider>
  );
}

/** TopNav reads this to render game-context chrome. Null when no game is open (or
 *  outside a provider) → the bar renders its normal board mode. */
export function useGameChrome(): GameChromeData | null {
  return useContext(ChromeValueCtx);
}

/** True when rendered inside a GameChromeProvider — i.e. hosted as a panel under
 *  TopNav. A game view uses this to suppress its own header + reposition below the
 *  bar; false (standalone route) keeps its self-hosted header. */
export function useInGamePanel(): boolean {
  return useContext(SetChromeCtx) != null;
}

/**
 * A game view publishes its current-screen chrome. No-op outside a provider
 * (standalone route). Re-publishes only when the RENDERED shape changes (title,
 * or gear/scorecard/nav presence) — the callbacks are read through a ref so their
 * per-render identity churn doesn't thrash the bar; the bar always invokes the
 * latest. Clears on unmount so closing the panel restores board mode. Depends on
 * the STABLE setter (not the value) so it never loops.
 */
export function usePublishGameChrome(data: GameChromeData | null) {
  const setChrome = useContext(SetChromeCtx);
  // Keep the latest data (with its fresh callbacks) in a ref the published proxy
  // reads at invoke time — updated post-commit so it never lags a tap.
  const ref = useRef(data);
  useEffect(() => {
    ref.current = data;
  });
  const key = data
    ? `${data.title}|${!!data.onSettings}|${!!data.onScorecard}|${!!data.hideBottomNav}`
    : "";
  useEffect(() => {
    if (!setChrome) return;
    if (!ref.current) {
      setChrome(null);
      return;
    }
    setChrome({
      title: ref.current.title,
      onSettings: ref.current.onSettings ? () => ref.current?.onSettings?.() : undefined,
      onScorecard: ref.current.onScorecard ? () => ref.current?.onScorecard?.() : undefined,
      hideBottomNav: ref.current.hideBottomNav,
    });
    return () => setChrome(null);
  }, [setChrome, key]);
}
