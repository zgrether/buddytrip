"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

/**
 * ChatSheet — chat's container below the chat-column breakpoint (<1280,
 * Phase 6). Elevated surface, partial height, resizable, never full — the
 * mobile/tablet counterpart to `AppShell`'s persistent `<aside>` column at
 * ≥1280. `ChatView` supplies the CONTENT (segments); this supplies the
 * CHROME (scrim, elevation, drag handle, snap points, dismiss).
 *
 * Takes its content as `children` — the SAME `<ChatView tripId canPost />`
 * element `AppShell` also hands to the `<aside>` at ≥1280 — rather than
 * constructing it internally, so there is exactly one place that assembles
 * `ChatView`'s props and this stays a pure container.
 *
 * ── Elevated, not a page ──────────────────────────────────────────────────
 * `--color-bt-card-float` (STYLE_GUIDE §1 Level 3), matching `Sheet.tsx` and
 * this app's other floating-over-a-scrim surfaces — this panel has a scrim,
 * so it is a floating dialog in STYLE_GUIDE's terms, not a Level-1 panel.
 * (The ≥1280 `<aside>` stays `--color-bt-card`: no scrim there, it's a
 * persistent layout region, not a floating dialog.)
 *
 * ── History ───────────────────────────────────────────────────────────────
 * `useModalBackButton` — the exact mechanism every other modal in the app
 * uses (`TripSettingsModal`, `InfoTileModal`, …), and the one `embedded`
 * chat previously had to DISABLE because Chat was a tab: switching tabs
 * unmounted/remounted the embedded panel out of step with the `?view=`
 * sentinel, and its push-on-mount/pop-on-unmount corrupted the stack. Chat is
 * no longer a tab, so this is a plain, self-contained modal lifecycle again —
 * open pushes one phantom entry, close (X, scrim, or back) pops exactly that
 * one, with no interaction with `?view=` at all.
 *
 * ── Placement: never covers the tab bar ──────────────────────────────────
 * `bottom: var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px))` leaves
 * the mobile tab bar (and,
 * ≥1024, its own toggle in `TopNav`) visible and tappable beneath the sheet —
 * that visibility is the whole point of chat not being a destination:
 * closing it (including via the SAME control that opened it) always works,
 * at every width, which is what removes the old tablet-width dead zone
 * rather than shifting it. z-index sits below `TopNav`/`AppTabBar` (z-40) on
 * purpose, for exactly that reason.
 */

const SNAP_FRACTIONS = [0.42, 0.62, 0.88] as const;
const MIN_HEIGHT_PX = 200;

/**
 * Height a drag settles on, as a FRACTION OF THE BAND (#1046).
 *
 * Pure, exported and unit-tested because the defect was arithmetic, not
 * markup: `currentPx` was divided by the band while the result was applied as a
 * fraction of the VIEWPORT, so the two disagreed by (topChrome + navH) and
 * every reading came back ~15% high.
 *
 * The property that pins it is the ROUND TRIP — apply a snap, measure it, get
 * the same snap back. Under the old code `nearestSnap(0.62 * band, band)`
 * returned 0.88, which is exactly the reported hair-trigger.
 */
export function nearestSnap(currentPx: number, bandPx: number): number {
  if (!(bandPx > 0)) return SNAP_FRACTIONS[1];
  const frac = currentPx / bandPx;
  let best: number = SNAP_FRACTIONS[0];
  for (const s of SNAP_FRACTIONS) {
    if (Math.abs(s - frac) < Math.abs(best - frac)) best = s;
  }
  return best;
}

/** The band a sheet may occupy, given the live chrome. Exported for the test
 *  that asserts the largest snap never tucks the grip under the top chrome. */
export function sheetBand(innerHeight: number, topChrome: number, navHeight: number): number {
  return innerHeight - topChrome - navHeight;
}

export function ChatSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useModalBackButton(onClose, open);

  const [heightFrac, setHeightFrac] = useState<number>(SNAP_FRACTIONS[1]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  /**
   * The band the sheet may occupy: viewport minus the top chrome and the tab
   * bar. **This is the ONE denominator** — the drag clamp, the snap, and the
   * effect that applies the height all call it, so a measured fraction and a
   * rendered fraction are the same number (#1046).
   *
   * ── The bug this replaces, measured ────────────────────────────────────
   * `handleDragEnd` divided the dragged pixels by THIS value while
   * `style.height` was written as a percentage of the **viewport**. On a
   * 390×844 phone the two differ by (topChrome + navH) = 169px, so every
   * reading was inflated ~15%: a sheet sitting at 62% measured as 0.716.
   *
   * All three reported symptoms fall out of that one mismatch:
   *   • drag UP 60px  → frac 0.798 → snaps to 0.88 (hair-trigger)
   *   • drag DOWN 80px → frac 0.606 → snaps back to 0.62 (feels dead; it took
   *     ~150px to move a notch, which is "I have to drag it up first")
   *   • 0.88 then resolved to 0.88 × 844 = 743px, putting the sheet's top edge
   *     at y=44 — UNDERNEATH the 112px top chrome, which sits at z-40 above
   *     this sheet's z-30. The grip became untappable and the only way out was
   *     a reload.
   *
   * ── Top chrome is MEASURED, not assumed ───────────────────────────────
   * It is not always 56: the PWA install banner renders inside the same sticky
   * z-40 slot, and a notched phone adds `env(safe-area-inset-top)`. Measured
   * live on a 390×844 viewport with the banner up: **112px**.
   *
   * Measured HERE rather than published as a CSS var by `AppShell`. That was
   * built first and did not work: the shell renders `TopBarSlot` more than once
   * (one instance hidden), a per-instance ResizeObserver attached to the wrong
   * one, and the var reported 56 while the slot was 112 — a number that LOOKS
   * measured and isn't, which is worse than an honest constant. Reading the DOM
   * at drag time takes whatever is actually on screen, however many shells
   * render, and needs no contract to keep in step.
   *
   * Falls back to 56 (the bar's own height) if nothing is found.
   */
  const availableHeight = useCallback(() => {
    const navH = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--bt-bottomnav-height") || "0"
    );
    let topInset = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="top-bar-slot"]')) {
      const r = el.getBoundingClientRect();
      // Only chrome actually pinned at the top obstructs the grip.
      if (r.height > 0 && r.top <= 1) topInset = Math.max(topInset, r.bottom);
    }
    return window.innerHeight - (topInset || 56) - (Number.isFinite(navH) ? navH : 0);
  }, []);

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = sheetRef.current?.getBoundingClientRect().height ?? 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const max = availableHeight();
      const next = Math.min(max, Math.max(MIN_HEIGHT_PX, dragStartHeight.current + delta));
      // Mutate the DOM directly during the drag — avoids a React re-render
      // on every pointer-move frame.
      if (sheetRef.current) sheetRef.current.style.height = `${next}px`;
    },
    [availableHeight]
  );

  const handleDragEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      const max = availableHeight();
      const currentPx = sheetRef.current?.getBoundingClientRect().height ?? max * SNAP_FRACTIONS[1];
      const best = nearestSnap(currentPx, max);
      setHeightFrac(best);
      // Write the resolved height directly rather than clearing to "" and
      // relying on the re-render this triggers: when `best` equals the CURRENT
      // `heightFrac` (any drag that doesn't cross into a different snap band —
      // the common case), React bails out of re-rendering on the same-value
      // state update, so clearing the inline override left the sheet with no
      // height at all — collapsing to its content's minimum size, which reads
      // as snapping back down to the bottom nav. Writing it directly is correct
      // whether or not React's own render ends up running.
      //
      // In PIXELS off `max`, not `${best * 100}%`. The percentage resolved
      // against the viewport while `frac` above was measured against `max`, and
      // that mismatch is the whole defect — see `availableHeight`.
      if (sheetRef.current) sheetRef.current.style.height = `${Math.round(best * max)}px`;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [availableHeight]
  );

  /**
   * Apply the height in PIXELS off `availableHeight()` — the SAME function the
   * drag clamp and the snap use, so a rendered fraction and a measured fraction
   * are the same number. The inline `height` in the style object below is a
   * first-paint fallback that this immediately replaces.
   *
   * Re-applies on resize because the band is a live measurement: rotating the
   * phone, the URL bar collapsing, or the PWA banner being dismissed all change
   * it, and a stale pixel height would silently stop matching its fraction.
   */
  useEffect(() => {
    if (!open) return;
    const apply = () => {
      if (sheetRef.current) {
        sheetRef.current.style.height = `${Math.round(heightFrac * availableHeight())}px`;
      }
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [open, heightFrac, availableHeight]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-30"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
        data-testid="chat-sheet-scrim"
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className="fixed left-0 right-0 z-30 flex flex-col overflow-hidden rounded-t-2xl"
        style={{
          bottom: "var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px))",
          /**
           * FIRST-PAINT FALLBACK ONLY — the effect above replaces this with the
           * measured value on the same tick. It assumes the bar's bare 56px
           * because CSS cannot do the DOM measurement `availableHeight()` does;
           * being slightly too tall for one frame is invisible, and the effect
           * corrects it before anyone can drag.
           *
           * `dvh`, not `vh`: on mobile `vh` is the LARGE viewport (URL bar
           * hidden) while `window.innerHeight` is the current one, so `vh` here
           * would reintroduce a smaller version of the very mismatch this fixes
           * every time Safari's bar is showing.
           */
          height: `calc(${heightFrac} * (100dvh - 56px - var(--bt-bottomnav-height, 0px)))`,
          /**
           * No `maxHeight` any more. It was `88vh`, a THIRD independent bound
           * that disagreed with both the drag clamp and the snap — and being a
           * fraction of the viewport rather than of the available band, it was
           * the loosest of the three, so it never actually caught anything the
           * clamp missed. The clamp and the snap now share one denominator and
           * the largest snap (0.88 of the band) cannot reach the top chrome.
           */
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
          borderBottom: "none",
          boxShadow: "0 -14px 40px rgba(0,0,0,0.35)",
        }}
        data-testid="chat-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Chat"
      >
        {/**
         * 44px, not 22. The visible pill stays 38×4 — this is the TOUCH TARGET
         * around it, and it was half the 44px minimum every platform guideline
         * uses. That is the "very narrow band where the drag actually starts;
         * the rest drags the screen behind it" in the #1046 report: `touchAction:
         * none` was correct and always had been, it just covered 22px of a
         * surface people aim at with a thumb. Outside those pixels the gesture
         * belongs to the page, which is why it scrolled instead.
         *
         * `pt-1.5` keeps the pill visually near the top edge, so the sheet does
         * not gain 22px of dead headroom in exchange for the bigger target.
         */}
        <div
          className="flex h-11 flex-shrink-0 items-start justify-center pt-1.5"
          style={{ cursor: "ns-resize", touchAction: "none" }}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          data-testid="chat-sheet-grip"
        >
          <span
            className="block rounded-full"
            style={{ width: 38, height: 4, background: "var(--color-bt-card-raised)" }}
          />
        </div>
        {children}
      </div>
    </>
  );
}
