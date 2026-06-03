"use client";

import { useCallback, useEffect, useState } from "react";

// ── useGuideDismissed ────────────────────────────────────────────────────
//
// Persists the setup-guide dismiss state per trip in localStorage. The flag
// is scoped to the *trip*, not the user, because the guide is owner-only
// and an owner who switches devices in the middle of setup probably wants
// to see it again on the new device — there's no harm in re-showing it.
//
// Returns a tuple: [dismissed, setDismissed]. setDismissed(true) hides,
// setDismissed(false) restores (used by the "Show setup guide" link).

const KEY = (tripId: string) => `bt-trip-${tripId}-setup-guide-dismissed`;

export function useGuideDismissed(
  tripId: string,
): [boolean, (next: boolean) => void] {
  // Lazy useState initializer reads localStorage on the very first
  // render. SSR returns false (window is undefined); on the client the
  // initial render reflects the persisted value. This sidesteps the
  // react-hooks/set-state-in-effect lint rule that hydration-via-effect
  // patterns trigger.
  const [dismissed, setDismissedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(KEY(tripId)) === "1";
    } catch {
      return false;
    }
  });

  // Re-read when tripId changes (rare — usually a route swap, since
  // each trip page has its own URL). The localStorage read is the
  // external system this effect synchronises against — exactly the
  // "subscribe for updates from an external system" case the lint
  // rule docs whitelist — so the directive below is intentional.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const next = window.localStorage.getItem(KEY(tripId)) === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissedState((cur) => (cur === next ? cur : next));
    } catch {
      // Storage disabled / private mode — keep current state.
    }
  }, [tripId]);

  const setDismissed = useCallback(
    (next: boolean) => {
      setDismissedState(next);
      if (typeof window === "undefined") return;
      try {
        if (next) window.localStorage.setItem(KEY(tripId), "1");
        else window.localStorage.removeItem(KEY(tripId));
      } catch {
        // Best-effort — state still flips in memory.
      }
    },
    [tripId],
  );

  return [dismissed, setDismissed];
}
