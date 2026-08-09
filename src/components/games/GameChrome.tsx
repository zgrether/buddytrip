"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

/**
 * GameChrome — a tiny context so a game view can publish its bar chrome (title +
 * the owner/delegate settings gear + the scorecard affordance + a focused-entry
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
  /** The GAME's name — the anchor, at every depth. Never the match/group name;
   *  that goes in `titleSuffix` so the two can be truncated differently. */
  title: string;
  /**
   * Depth inside the game — "Match 1", "Group 3" — rendered after the game name
   * as `game name — Match 1`.
   *
   * ── Why it is a separate field and not concatenated by the publisher ────────
   * Because the two halves need OPPOSITE truncation. At 375px "Match Play 2v2
   * Test 33 — Match 1" does not fit, and a single truncated string clips from the
   * right, eating the suffix — which is the part that says which match you're on,
   * i.e. the only part that differs between this screen and its three siblings.
   * Kept separate, the row can shrink the game NAME and hold the suffix whole.
   *
   * Drilling in used to REPLACE the title with "Match 1" / "Group 3", which threw
   * away the one piece of context the entry screen doesn't otherwise carry (the
   * match number is already in the strip directly beneath it; a group number
   * means little alone).
   */
  titleSuffix?: string;
  /** Owner/delegate-only settings gear. Present ⇒ the bar shows it. The VIEW
   *  gates on `useGameEditAccess`, so a member simply never passes it. */
  onSettings?: () => void;
  /** Opens the scorecard overlay (the entry surface's Table2 affordance, moved
   *  into the bar when the entry header is removed). Present ⇒ the bar shows it. */
  onScorecard?: () => void;
  /**
   * Rules of the day. Present ⇒ the action row shows the affordance AND owns the
   * sheet.
   *
   * Rules had no path at all once a game went into scoring: they live on the
   * settings page, the settings page is behind the owner/delegate gear, and the
   * people who most need to check the rules mid-round are the ones playing.
   * This is the scorecard's precedent applied to the other thing you look up
   * without wanting to change anything.
   *
   * ── DATA, not a callback, and that is deliberate ────────────────────────────
   * A `onRules: () => void` would put the open/closed state and the `<Sheet>`
   * mount in the VIEW — and three of the four views return from several
   * branches (config / entry / board), so the sheet would have to be mounted in
   * each, or be unreachable from the branch you were on. That is four
   * implementations of one overlay, which is the divergence CLAUDE.md #24
   * describes, pre-built.
   *
   * Publishing the data instead lets `GameActionRow` — which already renders for
   * exactly the surfaces this belongs on — own the state and the mount once.
   */
  rules?: {
    tripId: string;
    gameId: string;
    /** Seeds the starter text (the format explanation). */
    gameTypeId: string | null;
    /** Current persisted rules; null/empty → the starter shows. */
    text: string | null;
    /** Owner/delegate edits; a member reads. */
    canEdit: boolean;
  };
  /**
   * This is a focused SCORE-ENTRY surface — keeping score, not reading a board.
   *
   * ── What it does, and why it isn't called `hideBottomNav` any more ──────────
   * It used to name one effect (hide the trip bottom nav). It now names the
   * CONDITION, because entry hides chrome in two directions:
   *
   *   - the trip bottom nav, at every width (as before);
   *   - the top app bar, on MOBILE ONLY.
   *
   * Two booleans that must always agree is how they drift apart (CLAUDE.md #24),
   * and there is no surface that wants one without the other — so there is one
   * signal and each consumer derives its own effect from it.
   *
   * ── Why entry and not the scoreboard ────────────────────────────────────────
   * Entering scores is a focused, mis-tap-prone task, and it already covers the
   * screen; the bars are targets you don't want near your thumbs. A game
   * SCOREBOARD is the opposite — chat matters mid-round precisely because it
   * reaches the OTHER groups (nobody chats with the three people they're standing
   * next to), so both bars stay there.
   *
   * ── Desktop keeps its top bar ───────────────────────────────────────────────
   * At `lg+` the bar carries the Trip/Cup tabs and the chat toggle, which the
   * game's own `GameActionRow` does not duplicate — so hiding it there would
   * remove navigation rather than noise. Mobile only.
   *
   * Nothing is lost by hiding it: back · title · scorecard · settings live in
   * `GameActionRow` INSIDE the panel, not in the top bar (they moved there in
   * Phase 6). Exit stays exactly where it was.
   */
  focusedEntry?: boolean;
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
    ? `${data.title}|${data.titleSuffix ?? ""}|${!!data.onSettings}|${!!data.onScorecard}|${data.rules ? data.rules.gameId + data.rules.canEdit + (data.rules.text ?? "") : ""}|${!!data.focusedEntry}`
    : "";
  useEffect(() => {
    if (!setChrome) return;
    if (!ref.current) {
      setChrome(null);
      return;
    }
    setChrome({
      title: ref.current.title,
      titleSuffix: ref.current.titleSuffix,
      onSettings: ref.current.onSettings ? () => ref.current?.onSettings?.() : undefined,
      onScorecard: ref.current.onScorecard ? () => ref.current?.onScorecard?.() : undefined,
      rules: ref.current.rules,
      focusedEntry: ref.current.focusedEntry,
    });
    return () => setChrome(null);
  }, [setChrome, key]);
}
