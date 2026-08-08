"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
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

  // Available height for the sheet: viewport minus the 56px top nav and
  // whatever the tab bar/its offset currently is (0 at ≥1024, where the
  // mobile bar is hidden and the sheet is reachable only via TopNav's
  // toggle — see the module doc comment).
  const availableHeight = useCallback(() => {
    const navH = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--bt-bottomnav-height") || "0"
    );
    return window.innerHeight - 56 - navH;
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
      const frac = max > 0 ? currentPx / max : SNAP_FRACTIONS[1];
      let best: number = SNAP_FRACTIONS[0];
      for (const s of SNAP_FRACTIONS) {
        if (Math.abs(s - frac) < Math.abs(best - frac)) best = s;
      }
      setHeightFrac(best);
      // Hand height back to the percentage style now that we've snapped — set
      // it directly rather than clearing to "" and relying on the re-render
      // this triggers: when `best` equals the CURRENT `heightFrac` (any drag
      // that doesn't cross into a different snap band — the common case),
      // React bails out of re-rendering on the same-value state update, so
      // clearing the inline override left the sheet with no height at all —
      // collapsing to its content's minimum size, which reads as snapping
      // back down to the bottom nav. Writing the resolved value directly is
      // correct whether or not React's own render ends up running.
      if (sheetRef.current) sheetRef.current.style.height = `${best * 100}%`;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [availableHeight]
  );

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
          height: `${heightFrac * 100}%`,
          maxHeight: "88vh",
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
        <div
          className="flex h-[22px] flex-shrink-0 items-center justify-center"
          style={{ cursor: "ns-resize", touchAction: "none" }}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
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
