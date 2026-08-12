"use client";

import { useCallback, useState } from "react";

/**
 * The list column's width — expanded or contracted, persisted.
 *
 * ── Why localStorage rather than sessionStorage ─────────────────────────────
 * The precedent in this codebase splits by KIND, not by convenience:
 * `sessionStorage` holds POSITION (which chat segment you were on — where you
 * were), `localStorage` holds PREFERENCES (tee visibility, itinerary filters,
 * whether the setup guide is dismissed). A rail width is a preference, and a
 * global one rather than per-trip, so it gets one unscoped key.
 *
 * ── There is no zero state ──────────────────────────────────────────────────
 * Contracted is 246px — TODAY's rail width — not a collapse. The column is
 * always open, so nothing regresses for someone who never touches the toggle,
 * and there is no state where the switcher is unreachable.
 */
export const RAIL_EXPANDED_PX = 296;
/** Today's `RAIL_WIDTH_PX`. Contracted must not be narrower than what shipped. */
export const RAIL_CONTRACTED_PX = 246;
/** The entity strip — icon over label, fixed. */
export const RAIL_STRIP_PX = 62;

const KEY = "bt.railExpanded.v1";

/** Expanded unless storage says otherwise. SSR (and blocked storage) → the default. */
function readExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function useRailWidth(): { expanded: boolean; toggle: () => void; width: number } {
  // Lazy initializer reads localStorage on FIRST RENDER — the same shape
  // `useTeeVisibility` uses, and for the same two reasons: it avoids a one-frame
  // flash of the wrong width, and setting state inside an effect is what the
  // React Compiler lint refuses (`react-hooks/set-state-in-effect`). SSR has no
  // `localStorage`, so the reader falls back to the default there.
  const [expanded, setExpanded] = useState<boolean>(readExpanded);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        // As above — the toggle still works for this session.
      }
      return next;
    });
  }, []);

  return { expanded, toggle, width: expanded ? RAIL_EXPANDED_PX : RAIL_CONTRACTED_PX };
}
