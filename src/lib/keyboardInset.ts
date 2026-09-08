/**
 * How much of the window the on-screen keyboard is covering — and what a
 * bottom sheet should do about it.
 *
 * ── Why this is measured and not a CSS unit ───────────────────────────────
 *
 * `vh` is the LARGE viewport and never moves. `dvh` and `svh` track the
 * browser's collapsing address bar and **not the keyboard**: on iOS Safari the
 * keyboard does not resize the layout viewport at all, and on Chrome Android
 * the default `interactive-widget=resizes-visual` means the same. So every
 * viewport unit reports a window taller than the part you can see, a sheet
 * pinned to `bottom: 0` is pinned behind the keyboard, and its first fields sit
 * off the top of what is visible.
 *
 * This repo has already paid for that lesson twice from the other direction —
 * `ChatSheet` and `AppShell` both carry notes about `dvh`, then `svh`, both
 * being wrong under Chrome's collapsing bar, and both landed on measuring in JS
 * and applying pixels. This is that pattern for the keyboard case, and the
 * arithmetic is here rather than in the hook for the usual reason: the test
 * environment is `node`, so a hook can be written but never mounted, and a
 * number computed inside one could only ever be asserted as "a style was set".
 *
 * ── The geometry ──────────────────────────────────────────────────────────
 *
 * `window.innerHeight` is the LAYOUT viewport. `visualViewport` is the part
 * actually on screen, sitting at `offsetTop` within it. So whatever is below
 * `offsetTop + height` is covered — by the keyboard, or by a pinch-zoom that
 * has pushed the rest out of view, which wants the same treatment.
 */

/** Metrics as the browser reports them. Named so a test does not need a DOM. */
export interface ViewportMetrics {
  /** `window.innerHeight` — the LAYOUT viewport, which the keyboard never shrinks. */
  innerHeight: number;
  /** `visualViewport.height` — what is actually on screen. */
  viewportHeight: number;
  /** `visualViewport.offsetTop` — where the visible part starts. */
  offsetTop: number;
}

/**
 * Below this many px, an inset is NOT a keyboard and is left alone.
 *
 * A soft keyboard is ~250–350px on a phone. The things that produce a small
 * inset are an iPad's hardware-keyboard accessory bar (~55px) and sub-pixel
 * jitter while the address bar animates — treating either as a keyboard would
 * make the sheet twitch for no reason. 120 sits clear of both without being
 * near any real keyboard.
 */
export const KEYBOARD_MIN_INSET = 120;

/** Breathing room above the sheet so it reads as a sheet rather than a screen
 *  wedged against the top of the visible area. */
export const SHEET_TOP_GAP = 8;

/**
 * The keyboard's bite out of the bottom of the window, in CSS px — 0 when
 * there is no keyboard up, or when the numbers are not usable.
 *
 * Zero is the "do nothing" answer and every unusable input returns it, because
 * this is a progressive enhancement: a browser with no `visualViewport`, an
 * SSR render, and a phone with the keyboard closed must all leave the sheet
 * exactly as its CSS already has it.
 */
export function keyboardInset(m: ViewportMetrics): number {
  const covered = m.innerHeight - m.viewportHeight - m.offsetTop;
  if (!Number.isFinite(covered) || covered < KEYBOARD_MIN_INSET) return 0;
  return Math.round(covered);
}

/**
 * The two custom properties a bottom sheet needs while a keyboard is up, or
 * null when it needs none.
 *
 * CSS VARIABLES rather than inline styles, and that is load-bearing: the sheet
 * is a bottom sheet below `sm` and a full-height right drawer above it, and the
 * drawer's `sm:bottom-auto` / `sm:max-h-screen` classes have to keep winning.
 * An inline style beats every class including the responsive ones, so applying
 * pixels directly would pin the desktop drawer to a keyboard that is not there.
 * Feeding the values through vars the MOBILE classes read leaves the breakpoint
 * in the one place that already owns it.
 *
 * Both values are needed, not just the offset. Lifting the sheet without
 * capping it would push its top edge off the screen by exactly the height of
 * the keyboard — the first fields would go from below the fold to above it,
 * which is the same bug wearing a different hat.
 */
export function sheetKeyboardVars(
  m: ViewportMetrics
): { bottom: string; maxHeight: string } | null {
  const inset = keyboardInset(m);
  if (inset === 0) return null;
  return {
    bottom: `${inset}px`,
    maxHeight: `${Math.max(0, Math.round(m.viewportHeight - SHEET_TOP_GAP))}px`,
  };
}
