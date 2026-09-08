"use client";

import { useEffect, useState } from "react";
import { sheetKeyboardVars } from "@/lib/keyboardInset";

/**
 * Track the on-screen keyboard and hand back the CSS variables a bottom sheet
 * needs to sit above it — or null when there is nothing to do.
 *
 * The arithmetic is `keyboardInset.ts`; this is only the subscription, which is
 * the half that needs a browser and therefore the half that cannot be tested
 * here (`environment: "node"`). Keeping the split means the numbers are
 * asserted against values rather than against "a style attribute was present".
 *
 * ── Both events, not just resize ──────────────────────────────────────────
 *
 * `resize` fires when the keyboard opens and closes. `scroll` fires when iOS
 * pans the visual viewport WITHIN the layout viewport to reveal a focused
 * input — the height does not change there, `offsetTop` does, and the sheet
 * has to follow or it drifts out from under the keyboard mid-typing.
 *
 * Returns null and subscribes to nothing where `visualViewport` is missing
 * (SSR, older browsers), so the sheet renders exactly as its CSS already has
 * it. This is an enhancement, never a dependency.
 */
export function useKeyboardInset(): { bottom: string; maxHeight: string } | null {
  const [vars, setVars] = useState<{ bottom: string; maxHeight: string } | null>(null);

  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!vv) return;

    const read = () =>
      setVars((prev) => {
        const next = sheetKeyboardVars({
          innerHeight: window.innerHeight,
          viewportHeight: vv.height,
          offsetTop: vv.offsetTop,
        });
        // Same values ⇒ same object, so a `scroll` storm while typing does not
        // re-render the sheet (and every field inside it) on every frame.
        if (prev === next) return prev;
        if (prev && next && prev.bottom === next.bottom && prev.maxHeight === next.maxHeight) {
          return prev;
        }
        return next;
      });

    // Read the CURRENT viewport once on subscribe, not only on the next event.
    // Without this, a sheet opened while the keyboard is ALREADY up — tabbing
    // out of one field straight into this — sits behind it until something
    // happens to fire a resize.
    //
    // No `set-state-in-effect` disable needed: the rule fires on a direct
    // `setState(...)` in the effect body, and this goes through `read`. That is
    // a fact about the rule rather than a reason it does not apply, so if a
    // future lint version does flag it, the disable is correct and the reason
    // is the one above — the same "external data, read synchronously because
    // the source is synchronous" case the quick-game page's storage read makes.
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);

  return vars;
}
