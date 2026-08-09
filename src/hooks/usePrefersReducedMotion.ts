"use client";

import { useEffect, useState } from "react";

/**
 * Does this viewer ask for reduced motion?
 *
 * Almost every animation in this app honours the preference in CSS — a
 * `@media (prefers-reduced-motion: reduce)` block next to the keyframes, which
 * is the right tool because it needs no JavaScript and cannot get out of sync
 * with the rule it guards. This hook exists for the one thing CSS can't do:
 * decide whether a CONTROL should exist at all.
 *
 * The clinch celebration's "set off the fireworks" button is that case. Under
 * reduced motion the CSS suppresses the burst entirely, so the button would
 * still be there, still be tappable, and do visibly nothing — which is a worse
 * experience than not offering it. A control that lies about what it does is
 * not an accessible control.
 *
 * Follows the existing `useMediaMin` shape in `shell/breakpoints.ts`: false on
 * the server and on the first client render so hydration matches, corrected in
 * an effect, and subscribed to changes (the OS setting can be toggled while the
 * page is open).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
