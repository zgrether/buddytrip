"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The list column's width — continuous, draggable, persisted.
 *
 * ── Why localStorage rather than sessionStorage ─────────────────────────────
 * The precedent in this codebase splits by KIND, not by convenience:
 * `sessionStorage` holds POSITION (which chat segment you were on — where you
 * were), `localStorage` holds PREFERENCES (tee visibility, itinerary filters,
 * whether the setup guide is dismissed). A rail width is a preference, and a
 * global one rather than per-trip, so it gets one unscoped key.
 *
 * ── One mechanism, not three ────────────────────────────────────────────────
 * The width was two constants and a toggle. It is now ONE number that the drag
 * sets directly and the button snaps between two known values — the button is
 * "snap wide / snap narrow", not expand/contract, because drag already covers
 * everything in between and a third control would be a third way to say the same
 * thing.
 *
 * ── There is no zero state ──────────────────────────────────────────────────
 * `RAIL_SNAP_NARROW_PX` is 246 — TODAY's rail width — so the narrow snap doesn't
 * regress what shipped, and the DRAG floor is computed from the widest rendered
 * trip name (see `ContextRail`), never zero. The column is always open.
 */

/** The wide snap, and the drag ceiling. */
export const RAIL_EXPANDED_PX = 296;
/** The narrow snap. Today's `RAIL_WIDTH_PX` — the narrow state must not regress. */
export const RAIL_CONTRACTED_PX = 246;
/**
 * Absolute floor for the DRAG, whatever the names measure. A rail narrower than
 * this stops being a switcher regardless of how short the trip titles happen to
 * be — the section headers, the key and the countdown band all still have to fit.
 */
export const RAIL_MIN_PX = 200;
/** The entity strip — icon over label, fixed. */
export const RAIL_STRIP_PX = 62;

const KEY = "bt.railWidth.v2";

/** Clamp to the drag range. `floor` is measured per-drag; default to the narrow snap. */
export function clampRailWidth(px: number, floor = RAIL_CONTRACTED_PX): number {
  return Math.round(Math.min(RAIL_EXPANDED_PX, Math.max(Math.max(RAIL_MIN_PX, floor), px)));
}

/**
 * ── An EXTERNAL STORE, not component state ──────────────────────────────────
 *
 * `localStorage` is an external system, and the width has a server value that
 * cannot match the client's. A `useState` lazy initializer got this WRONG in a
 * way worth recording: the server rendered the default (296) into the HTML, the
 * client initializer read the stored 264, and hydration kept the server's inline
 * `width: 296px` while every value DERIVED from the state — `wide`, and so
 * whether the row art rendered — used 264. The rail painted at its wide width
 * with its narrow contents.
 *
 * `useSyncExternalStore` exists for exactly this: it takes a server snapshot and
 * a client snapshot as separate functions, and React reconciles them after
 * hydration itself. No effect (which the compiler lint refuses anyway), no
 * mismatch, and no frame of the wrong width.
 *
 * v2 key: v1 stored a boolean ("is it expanded"), which cannot express a dragged
 * width. A stale v1 value is ignored rather than migrated — the cost of getting
 * it wrong is one rail width on one device, and a migration is more code than
 * the thing it protects.
 */
let cached: number | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Client snapshot. Cached so repeat reads are not repeat `localStorage` hits,
 *  and so the value is referentially stable between notifications. */
function getSnapshot(): number {
  if (cached != null) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    const n = raw == null ? NaN : Number(raw);
    cached = Number.isFinite(n) ? clampRailWidth(n, RAIL_MIN_PX) : RAIL_EXPANDED_PX;
  } catch {
    cached = RAIL_EXPANDED_PX;
  }
  return cached;
}

/** Server snapshot — there is no storage, so the wide snap is the honest default. */
function getServerSnapshot(): number {
  return RAIL_EXPANDED_PX;
}

export function useRailWidth(): {
  width: number;
  /** True when the width is nearer the wide snap — drives which way the button snaps. */
  wide: boolean;
  /** Snap to the other known state. */
  snap: () => void;
  /** Continuous set, from the drag. Clamped against the caller's measured floor. */
  setWidth: (px: number, floor?: number) => void;
} {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setWidth = useCallback((px: number, floor?: number) => {
    const next = clampRailWidth(px, floor);
    if (next === cached) return;
    cached = next;
    try {
      window.localStorage.setItem(KEY, String(next));
    } catch {
      // Private mode / blocked storage: the width still works for this session.
    }
    listeners.forEach((l) => l());
  }, []);

  // Nearer the wide end → the button offers narrow, and vice versa. A midpoint
  // test rather than a remembered flag, so a dragged width always has a defined
  // answer without a second piece of state to keep in step.
  const wide = width > (RAIL_CONTRACTED_PX + RAIL_EXPANDED_PX) / 2;

  const snap = useCallback(() => {
    setWidth(wide ? RAIL_CONTRACTED_PX : RAIL_EXPANDED_PX, RAIL_MIN_PX);
  }, [wide, setWidth]);

  return { width, wide, snap, setWidth };
}
