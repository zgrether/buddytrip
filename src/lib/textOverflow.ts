/**
 * Pure predicates behind the itinerary's tap-to-expand truncated text
 * affordance (EventCard in ItineraryView.tsx, EventRow in the legacy
 * ItineraryPanel.tsx). Kept separate from the DOM-measuring hook
 * (`useTextOverflow`, src/hooks/useTextOverflow.ts) so the decision logic is
 * unit-testable: this repo's vitest suite runs with `environment: "node"`
 * (vitest.config.mts) — no DOM, no ResizeObserver — so the hook itself is
 * verified live in the browser preview, not here.
 */

/**
 * Does a measured box overflow horizontally?
 *
 * SINGLE-LINE ONLY. Under `line-clamp` (multi-line truncation) a wrapped
 * block has no horizontal overflow — its `scrollWidth` equals its rendered
 * width no matter how much text is hidden below the fold — so this would
 * silently report "not truncated" for content that plainly is (ContextRail.tsx
 * hit the same landmine measuring a clamped title). If this is ever extended
 * past one line, re-derive the check — compare `scrollHeight`/`clientHeight`
 * against the clamped line count instead of reusing this.
 */
export function isOverflowingBox(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}

/**
 * Whether the expand/collapse chevron should render.
 *
 * Shown once truncation is detected, and STAYS shown once expanded — even if
 * a resize mid-read means the text no longer strictly overflows at the
 * card's current width, the reader still needs a way back to collapsed.
 */
export function shouldShowExpandAffordance(isOverflowing: boolean, expanded: boolean): boolean {
  return isOverflowing || expanded;
}
