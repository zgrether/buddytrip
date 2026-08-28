"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock, for surfaces whose correctness depends on the current time.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Pick'em's countdown was computed once at render and never moved. Reported at
 * the first look: "a countdown that doesn't count is worse than a timestamp,
 * because it looks live". Someone glances at it twice over ten minutes, sees
 * the same number, and either misses it or decides the page is stale.
 *
 * It is also load-bearing rather than decorative. Reminders need a scheduler
 * and are deferred, so nothing will ever notify anyone — the clock is the whole
 * mechanism telling sixteen people to get their picks in.
 *
 * ── The value is the POINT, not just the re-render ─────────────────────────
 *
 * Callers derive every time-dependent answer from the returned `now`, not only
 * the number they display: `picksOpen(clock, now)`, `msUntilDeadline(clock,
 * now)`, `pickemClosure(clock, now)`. That is what makes crossing zero correct
 * without a reload — at the deadline the same tick that shows 0:00 also flips
 * the sheet read-only and produces the closed message, because they all read
 * one clock.
 *
 * A countdown reaching 0:00 while the sheet stays editable is the worst version
 * of this bug, and it is exactly what a hook that only forced a re-paint of the
 * timer would produce.
 *
 * ── Paused while hidden ────────────────────────────────────────────────────
 *
 * A backgrounded tab does not need a per-second timer, and phones throttle or
 * kill them anyway. On becoming visible it ticks IMMEDIATELY rather than
 * waiting out the interval — returning to an app that shows a stale time for
 * another second is the same defect in miniature.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (timer !== undefined) return;
      // Catch up first: whatever elapsed while hidden or before mount is
      // already wrong on screen.
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") stop();
      else start();
    };

    // `document` is absent under SSR and in the node test environment; the
    // initial `Date.now()` is still a correct first value there.
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);

  return now;
}
