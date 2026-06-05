// ── Rail layout contract ────────────────────────────────────────────────────
//
// News and Chat are two separate panels that share ONE window style and ONE
// size. The title-bar buttons act like radio buttons: switching between them
// keeps the panel's size and position identical. That only works if both
// panels agree on the same dimensions and read/write the SAME persisted size —
// this module is that single source of truth.
//
// Desktop: a docked right rail, width clamped to [MIN, MAX], persisted per
// user. Mobile: a bottom sheet whose height is persisted as a fraction of the
// viewport. Because News and Chat are mutually exclusive (opening one closes
// the other), each remounts on switch and re-reads these values — so the
// newly-opened panel always appears at the size the other one was just at.

export const RAIL_MIN_WIDTH = 340;
export const RAIL_MAX_WIDTH = 680;
export const RAIL_DEFAULT_WIDTH = 400;

/** Shared localStorage keys — News and Chat MUST use these so size carries
 *  across a switch (and across open/close). */
export const RAIL_WIDTH_KEY = "bt-rail-width";
export const RAIL_SHEET_KEY = "bt-rail-sheet-height";

/** Mobile sheet height bounds, as a fraction of innerHeight. */
export const RAIL_SHEET_MIN_RATIO = 0.25;
export const RAIL_SHEET_MAX_RATIO = 0.95;

export function clampRailWidth(w: number): number {
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, w));
}

/** Initial desktop width: last persisted (clamped) or the default. */
export function readRailWidth(): number {
  if (typeof window === "undefined") return RAIL_DEFAULT_WIDTH;
  const saved = parseInt(localStorage.getItem(RAIL_WIDTH_KEY) ?? "", 10);
  return Number.isNaN(saved) ? RAIL_DEFAULT_WIDTH : clampRailWidth(saved);
}

export function persistRailWidth(w: number): void {
  try {
    localStorage.setItem(RAIL_WIDTH_KEY, String(w));
  } catch {
    /* localStorage unavailable */
  }
}

/** Initial mobile sheet height in px (clamped), or null to fall back to 85vh. */
export function readRailSheetHeight(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const ratio = parseFloat(localStorage.getItem(RAIL_SHEET_KEY) ?? "");
    if (!Number.isNaN(ratio)) {
      const min = window.innerHeight * RAIL_SHEET_MIN_RATIO;
      const max = window.innerHeight * RAIL_SHEET_MAX_RATIO;
      return Math.round(Math.min(max, Math.max(min, ratio * window.innerHeight)));
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function persistRailSheetHeight(px: number): void {
  try {
    localStorage.setItem(RAIL_SHEET_KEY, String(px / window.innerHeight));
  } catch {
    /* localStorage unavailable */
  }
}
