"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * useShrinkToFit — a name gets smaller rather than losing its tail.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * A TEAM NAME NEVER ELLIPSISES. These are the crew's own names — the joke IS
 * the content, and "Booty Hunters & Scurvy Hoo…" is not a shorter version of
 * the joke, it is the joke broken. So when a name will not fit its box at the
 * normal size, the TYPE shrinks until it does, down to a floor.
 *
 * ── Why a measurement and not a character count ────────────────────────────
 *
 * The obvious cheap version — "over N characters, use the small size" — is the
 * mistake this hook exists to stop repeating. It has now been made twice here:
 * a comment claimed the two-line clamp "should never fire with the 34-char
 * input cap", and a column width was tuned against a 21-char name and shipped
 * truncating a 30-char one. Both times the reasoning was about the LENGTH of
 * the string, and both times what actually decided was the longest WORD against
 * the column it was given:
 *
 *   "Booty Hunters & Scurvy Hookers"   30 chars, fits two lines
 *   "Wonderful Magnificent Splendids"  31 chars, needs three
 *
 * One character apart, opposite outcomes. No character count can tell those
 * apart, because the answer depends on the font, the column, and where the
 * spaces fall. So this asks the BROWSER, which is the only thing that knows.
 *
 * ── What "fits" means ──────────────────────────────────────────────────────
 *
 * The element keeps its `line-clamp`, and the test is whether the clamp is
 * currently hiding anything: `scrollHeight > clientHeight` is true exactly when
 * content is being cut. So the predicate is the ellipsis itself — we shrink
 * until the thing we are trying to avoid stops happening, rather than modelling
 * when it would.
 *
 * The clamp STAYS as the floor's backstop. A name that still does not fit at
 * the smallest size is clipped, which is the old behaviour and strictly better
 * than type too small to read.
 *
 * ── The block does not move ────────────────────────────────────────────────
 *
 * Shrinking one side must not shorten its block, or `ROSTER` and the two big
 * scores below would land on different baselines — the exact defect the
 * two-line reserve exists to prevent, arriving through the fix for a different
 * one. The reserve is sized from the CONTAINER's font size, which this never
 * touches; only the inner text element scales. Callers must keep it that way:
 * put the reserve on the parent, the ref on the child.
 */

/**
 * The pure half: the largest candidate that fits.
 *
 * Separated from the DOM so it can be tested — the measuring half cannot be,
 * because jsdom has no layout engine and reports every height as 0, which would
 * make a "test" of it assert that everything fits at full size. Stated here
 * rather than implied: `useShrinkToFit` itself is covered by rendering in a
 * real browser, and by nothing in the suite.
 *
 * `sizes` is largest-first. Returns the last (smallest) when none fit, because
 * a floor that clips beats a floor that overflows its box.
 */
export function largestFittingSize(sizes: number[], fits: (size: number) => boolean): number {
  if (sizes.length === 0) throw new Error("useShrinkToFit: sizes must not be empty");
  for (const size of sizes) {
    if (fits(size)) return size;
  }
  return sizes[sizes.length - 1];
}

/** 17 is the designed size; 11 is the floor where the name is still a name.
 *  Largest-first — `largestFittingSize` takes the first that fits. */
export const NAME_SIZES = [17, 16, 15, 14, 13, 12, 11];

export function useShrinkToFit(
  ref: React.RefObject<HTMLElement | null>,
  /** Re-measure when this changes — the text, normally. */
  text: string,
  sizes: number[] = NAME_SIZES,
): number {
  const [size, setSize] = useState(sizes[0]);
  // The width we last measured at. A ResizeObserver on the parent fires for
  // HEIGHT changes too, and our own shrink can change the parent's height — so
  // re-measuring on every callback is a loop. Width is the only input that
  // matters here and it cannot be changed by the font size.
  const lastWidth = useRef(-1);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const restore = el.style.fontSize;
    const best = largestFittingSize(sizes, (candidate) => {
      el.style.fontSize = `${candidate}px`;
      // Reading a layout property forces the reflow, so this is measured at the
      // candidate size rather than the previous one.
      return el.scrollHeight <= el.clientHeight + 1;
    });
    el.style.fontSize = restore;
    setSize(best);
  }, [ref, sizes]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastWidth.current = -1;
    measure();

    const parent = el.parentElement ?? el;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? -1;
      if (Math.abs(width - lastWidth.current) < 0.5) return;
      lastWidth.current = width;
      measure();
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [measure, ref, text]);

  // A webfont swapping in after hydration changes every metric this measured
  // against, and the first paint is usually the fallback face. Not in the layout
  // effect: `fonts.ready` resolves asynchronously either way, so it cannot block
  // paint, and it must not re-run when only the observer is rebuilt.
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready
      .then(() => {
        if (!cancelled) measure();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [measure, text]);

  return size;
}
