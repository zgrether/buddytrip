"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WINNER_NAME_PX, WINNER_NAME_WEIGHT } from "@/lib/teamTextColor";
import { nameWords, winnerNameFit, type WinnerNameFit } from "@/lib/winnerNameFit";

const FULL: WinnerNameFit = { size: WINNER_NAME_PX, breakAnywhere: false };

/**
 * useWinnerNameFit — the measuring half of `winnerNameFit` (#1703).
 *
 * Measures each WORD of the name at 20px bold in the name's own font, with a
 * hidden probe beside it (the browser's own text layout, so kerning and the
 * webfont match what is drawn), and gives the size and wrap the rule picks for
 * the column. The column is `share` of the ROW the name block sits in, not the
 * block itself: the block is content-sized under a max-width, so its own width
 * would only ever report that the name fits.
 *
 * Off (`enabled` false) it returns the full size and measures nothing. In a node
 * render it measures nothing either, so the first paint is 20px, as it is in a
 * browser until the layout effect runs (before paint).
 */
export function useWinnerNameFit(
  nameRef: React.RefObject<HTMLElement | null>,
  rowRef: React.RefObject<HTMLElement | null>,
  text: string,
  share: number,
  enabled: boolean,
): WinnerNameFit {
  const [fit, setFit] = useState<WinnerNameFit>(FULL);
  const lastWidth = useRef(-1);

  const measure = useCallback(() => {
    const el = nameRef.current;
    const row = rowRef.current;
    if (!enabled || !el || !row) return;
    const cs = getComputedStyle(el);
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    Object.assign(probe.style, {
      position: "absolute",
      visibility: "hidden",
      whiteSpace: "nowrap",
      fontFamily: cs.fontFamily,
      fontSize: `${WINNER_NAME_PX}px`,
      fontWeight: String(WINNER_NAME_WEIGHT),
      letterSpacing: cs.letterSpacing,
      fontFeatureSettings: cs.fontFeatureSettings,
    });
    (el.parentElement ?? document.body).appendChild(probe);
    let longest = 0;
    for (const word of nameWords(text)) {
      probe.textContent = word;
      longest = Math.max(longest, probe.getBoundingClientRect().width);
    }
    probe.remove();
    const next = winnerNameFit(longest, row.clientWidth * share);
    setFit((prev) => (prev.size === next.size && prev.breakAnywhere === next.breakAnywhere ? prev : next));
  }, [nameRef, rowRef, text, share, enabled]);

  useLayoutEffect(() => {
    if (!enabled) {
      setFit(FULL);
      return;
    }
    const row = rowRef.current;
    if (!row) return;
    lastWidth.current = -1;
    measure();
    // The row's WIDTH is the only input; our own size change moves its height.
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? -1;
      if (Math.abs(width - lastWidth.current) < 0.5) return;
      lastWidth.current = width;
      measure();
    });
    ro.observe(row);
    return () => ro.disconnect();
  }, [measure, rowRef, enabled]);

  // A webfont swapping in after hydration changes every width measured above.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    document.fonts?.ready
      .then(() => {
        if (!cancelled) measure();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [measure, enabled]);

  return enabled ? fit : FULL;
}
