"use client";

import { useEffect, useState, type RefObject } from "react";
import { isOverflowingBox } from "@/lib/textOverflow";

/**
 * Detects whether a single-line, CSS-`truncate`d text node is ACTUALLY
 * overflowing — never guess from string length; two visually different
 * strings can occupy the same rendered width depending on their characters,
 * the font, and the column they sit in. Re-measures live via ResizeObserver,
 * the same reflow-detection idiom as TripHeaderDock / NewsPanel.
 *
 * Takes the ref rather than creating and returning one — the caller owns a
 * plain `useRef` and passes it both here and to the element's `ref` prop.
 * (The tried alternative, returning `{ ref, isOverflowing }` from this hook,
 * trips `react-hooks/refs`: it can't see into a custom hook to confirm a
 * bundled ref is only ever read inside an effect, so it flags every read of
 * a sibling field off the same object as a possible render-time ref read.)
 *
 * SINGLE-LINE ONLY — see the comment on `isOverflowingBox`
 * (src/lib/textOverflow.ts) for why `line-clamp` would break this silently.
 *
 * Not unit-tested directly: this repo's vitest suite runs with
 * `environment: "node"` (vitest.config.mts) — no DOM, no ResizeObserver — so
 * the decision logic lives in the pure, tested `isOverflowingBox`, and this
 * hook's actual browser behavior is verified live in the preview.
 */
export function useTextOverflow<T extends HTMLElement>(
  ref: RefObject<T | null>,
  text: string | null | undefined
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      setIsOverflowing(el ? isOverflowingBox(el.scrollWidth, el.clientWidth) : false);
    };
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `text` stands in for "the rendered content changed" — an edit can move
    // overflow independent of any resize.
  }, [ref, text]);

  return isOverflowing;
}
