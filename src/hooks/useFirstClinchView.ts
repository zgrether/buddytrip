"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Has this device already watched this cup's clinch celebration?"
 *
 * The burst plays on FIRST VIEW and never again — after that the hero settles
 * into its still final state (glow and trophy stay, the sparks don't replay).
 *
 * ── Why localStorage, per device ────────────────────────────────────────────
 *
 * Migration 099 states the design plainly: clinch state "remains fully derived"
 * and nothing about it is stored. A per-user seen-flag in the database would be
 * a new stored concept plus a migration, to decide whether an animation plays.
 * localStorage costs neither, and the app already does exactly this for the
 * setup guide (`useGuideDismissed`). The trade is that a second device, a
 * cleared browser or private mode replays it once — which is the right failure
 * direction for a celebration.
 *
 * ── Keyed by competition AND clincher, mirroring 099 ────────────────────────
 *
 * 099's push claim uses `clinch_notified_team_id IS DISTINCT FROM :team`, so a
 * team re-clinching after a correction sends no second push, while a DIFFERENT
 * team clinching does. This key reproduces that: a correction that un-clinches
 * and then re-clinches the SAME team finds its flag already set (no replay); if
 * the correction flips the cup to the other team, the key changes and that
 * genuinely new result gets its moment.
 *
 * ── The write is deliberately late ──────────────────────────────────────────
 *
 * `markSeen` is called by the consumer when the celebration actually renders,
 * not when this hook mounts. A flag written on mount would burn the one showing
 * on a render that never displayed anything — the exact "flag survives so long
 * the first viewing is missed" failure. Nothing is written until something has
 * been seen.
 */

const KEY = (competitionId: string, teamId: string) =>
  `bt-clinch-seen-${competitionId}-${teamId}`;

export interface FirstClinchView {
  /** True when this device has NOT yet seen this cup+team celebration. */
  isFirstView: boolean;
  /** Record that the celebration has now been shown. Idempotent. */
  markSeen: () => void;
}

/**
 * @param competitionId  the cup
 * @param clincherTeamId the winning team, or null when nothing has clinched —
 *                       null yields `isFirstView: false` (nothing to celebrate)
 *                       and an inert `markSeen`, so callers need no branch.
 */
export function useFirstClinchView(
  competitionId: string,
  clincherTeamId: string | null,
): FirstClinchView {
  // Lazy initializer, not an effect: the very first client render must already
  // know, or a returning viewer sees one frame of celebration before it's
  // corrected. SSR has no window and returns false — the "already seen" side,
  // so the server never emits a burst that hydration then has to take away.
  // Same reasoning (and the same lint-rule sidestep) as `useGuideDismissed`.
  const read = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    if (!clincherTeamId) return false;
    try {
      return window.localStorage.getItem(KEY(competitionId, clincherTeamId)) !== "1";
    } catch {
      // Storage disabled / private mode. Treat as seen: a celebration that
      // replays on every render is far worse than one that never plays.
      return false;
    }
  }, [competitionId, clincherTeamId]);

  const [isFirstView, setIsFirstView] = useState<boolean>(read);

  // Re-read when the cup or the clincher changes — a correction can move the
  // clinch to the other team within one mounted board, and that new result has
  // its own key and its own first view.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsFirstView((cur) => {
      const next = read();
      return cur === next ? cur : next;
    });
  }, [read]);

  // Guards the same key being marked twice inside one mount (StrictMode runs
  // effects twice; a re-render could call this again before state settles).
  const markedRef = useRef<string | null>(null);

  const markSeen = useCallback(() => {
    if (!clincherTeamId) return;
    const key = KEY(competitionId, clincherTeamId);
    if (markedRef.current === key) return;
    markedRef.current = key;
    setIsFirstView(false);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Best-effort — the in-memory flip above still stops a replay this session.
    }
  }, [competitionId, clincherTeamId]);

  return { isFirstView, markSeen };
}
