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
 * ONE number. The drag sets it continuously between the measured floor and
 * `RAIL_MAX_PX`; the button sets it to `0` and back. There is no third control
 * and no second piece of state — "collapsed" is `width === 0`, not a flag that
 * has to be kept in step with the width.
 *
 * ── THE BUTTON REVERSED, DELIBERATELY (this supersedes the previous spec) ───
 * The version this replaces said, in this file, that there is "no zero state"
 * and that the column "is always open", and the button was snap-wide /
 * snap-narrow between two known widths. Both are now false ON PURPOSE, and the
 * reversal is recorded here rather than left to read as drift.
 *
 * What changed the answer is the TRAVEL. Two snaps 50px apart (246 ↔ 296) is
 * not a range worth a divider — the drag and the button were competing to
 * express the same 50px, which is what made the button feel redundant and the
 * drag feel pointless. So they were split by KIND instead of by amount: the
 * button now does the one thing the drag cannot (take the list away entirely,
 * leaving the 62px icon strip), and the drag owns the whole continuous range,
 * which is now ~180px rather than 50.
 *
 * `RAIL_MAX_PX` = 380 is PROVISIONAL — a starting value chosen to roughly
 * triple the old travel from the 296 that shipped, to be reassessed on a real
 * device. It is not derived from anything measured.
 *
 * The button reopens to the MINIMUM, not to where you were. Reopening wide
 * would make the button a second way to express a width the drag already owns
 * — the same collision that got this reversed in the first place.
 */

/** The drag ceiling. PROVISIONAL — see the note above. */
export const RAIL_MAX_PX = 380;
/** First-visit width, and the server snapshot. Today's expanded width. */
export const RAIL_DEFAULT_PX = 296;
/**
 * Absolute floor for the DRAG, whatever the names measure. A rail narrower than
 * this stops being a switcher regardless of how short the trip titles happen to
 * be — the section headers, the key and the countdown band all still have to fit.
 */
export const RAIL_MIN_PX = 200;
/**
 * The CAP on the measured floor — the width that already shipped as the narrow
 * snap. A pathological name can push the measured floor up to here and no
 * further, which is what keeps it a wart rather than a lock (see
 * `ContextRail.measureFloor`).
 */
export const RAIL_CONTRACTED_PX = 246;
/** Collapsed — the icon strip alone, no list column. */
export const RAIL_COLLAPSED_PX = 0;
/** The entity strip — icon over label, fixed. */
export const RAIL_STRIP_PX = 62;
/**
 * At or above this width the row art (silhouette + trophy) earns its 46px.
 *
 * This used to be DERIVED — the midpoint between the two snaps, so that "wide"
 * and "which way does the button snap" were guaranteed to be the same question.
 * The button no longer has two snaps, so that derivation is gone and the
 * threshold has to be stated. 272 is exactly the old midpoint of 246 and 296,
 * kept to the pixel so that widening the range doesn't silently repaint every
 * existing rail that happens to sit near it.
 */
export const RAIL_ART_MIN_PX = 272;

const KEY = "bt.railWidth.v2";

/** Clamp to the drag range. `floor` is measured per-drag; default to the cap on
 *  the measured floor. Never returns the collapsed value — collapsing is the
 *  button's job, and a drag that could land on 0 would be a second way to do it. */
export function clampRailWidth(px: number, floor = RAIL_CONTRACTED_PX): number {
  return Math.round(Math.min(RAIL_MAX_PX, Math.max(Math.max(RAIL_MIN_PX, floor), px)));
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

/**
 * Turn a stored string into a width. Exported ONLY so it can be tested: this is
 * the half of the persistence round-trip that #902 got wrong, and a write
 * succeeding is not the same as a read landing.
 *
 * The specific trap is `0`. It is a REAL stored value (collapsed), not
 * something to clamp up to the floor — a read that clamped it would make the
 * collapse un-persistable, so the write would succeed and the reload would come
 * back at 200. Same shape as the #902 hydration bug in a different costume.
 */
export function decodeStoredWidth(raw: string | null): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return RAIL_DEFAULT_PX;
  if (n <= RAIL_COLLAPSED_PX) return RAIL_COLLAPSED_PX;
  return clampRailWidth(n, RAIL_MIN_PX);
}

/** Client snapshot. Cached so repeat reads are not repeat `localStorage` hits,
 *  and so the value is referentially stable between notifications. */
function getSnapshot(): number {
  if (cached != null) return cached;
  try {
    cached = decodeStoredWidth(window.localStorage.getItem(KEY));
  } catch {
    cached = RAIL_DEFAULT_PX;
  }
  return cached;
}

/** Server snapshot — there is no storage, so the default is the honest one. */
function getServerSnapshot(): number {
  return RAIL_DEFAULT_PX;
}

function write(next: number): void {
  if (next === cached) return;
  cached = next;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // Private mode / blocked storage: the width still works for this session.
  }
  listeners.forEach((l) => l());
}

export function useRailWidth(): {
  /** The list column's width. `0` means collapsed — the strip alone. */
  width: number;
  /** `width === 0`. Derived, never stored twice. */
  collapsed: boolean;
  /** Wide enough for the row art. */
  wide: boolean;
  /** Continuous set, from the drag. Clamped against the caller's measured floor. */
  setWidth: (px: number, floor?: number) => void;
  /** Take the list away entirely. The one thing the drag cannot do. */
  collapse: () => void;
} {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setWidth = useCallback((px: number, floor?: number) => {
    write(clampRailWidth(px, floor));
  }, []);

  const collapse = useCallback(() => {
    write(RAIL_COLLAPSED_PX);
  }, []);

  return {
    width,
    collapsed: width === RAIL_COLLAPSED_PX,
    wide: width >= RAIL_ART_MIN_PX,
    setWidth,
    collapse,
  };
}
