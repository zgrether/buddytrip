"use client";

import { useEffect, useRef } from "react";
import { attachReconnectTriggers, keysToRetry, type RetryStatusMap } from "@/lib/retryOnReconnect";

/**
 * Re-send a score saver's unsynced cells when the network is likely back
 * (#1622). See `src/lib/retryOnReconnect.ts` for the triggers and which cells.
 *
 * `retryKey` re-sends ONE cell by its key, through the saver's own `retryCell`.
 * The latest status, refusals and `retryKey` are read through refs, so the
 * listeners attach once per mount and never go stale.
 */
export function useRetryOnReconnect(
  saveStatus: RetryStatusMap,
  refusals: Record<string, string> | undefined,
  retryKey: (key: string) => void,
): void {
  const latest = useRef({ saveStatus, refusals, retryKey });
  // Kept current after every commit (not during render), the same way
  // useScoreSaver mirrors its saveStatus. A trigger always fires from an event
  // or a timer, after the commit it should see.
  useEffect(() => {
    latest.current = { saveStatus, refusals, retryKey };
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    return attachReconnectTriggers({
      win: window,
      doc: document,
      onTrigger: () => {
        const { saveStatus: s, refusals: r, retryKey: retry } = latest.current;
        for (const key of keysToRetry(s, r)) retry(key);
      },
    });
  }, []);
}
