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
  const [dismissed, setDismissedState] = useState<boolean>(false);

  // Hydrate once on mount from localStorage. Guarded so SSR (Next.js
  // server render) doesn't trip on `window`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setDismissedState(window.localStorage.getItem(KEY(tripId)) === "1");
    } catch {
      // Storage disabled / private mode — fall through with default false.
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
