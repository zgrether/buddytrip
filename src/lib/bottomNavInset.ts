/**
 * CLEARANCE FOR THE FIXED BOTTOM NAV, as one expression.
 *
 * The bar overlays the content beneath it (nav `z-40`, game panel `z-30`), so
 * any surface whose content can reach the bottom of the viewport has to inset
 * itself or its last row sits under the tabs.
 *
 * ── Why `var(…, env(…))` and not an addition ────────────────────────────────
 *
 * `--bt-bottomnav-height` is `AppTabBar`'s MEASURED `offsetHeight`, republished
 * by a ResizeObserver, and it already includes the bar's own safe-area padding.
 * So where the bar is showing, adding `env(safe-area-inset-bottom)` on top would
 * double-count the inset and leave a visible gap. But `AppTabBar` REMOVES the
 * property when it unmounts — which it does on focused entry surfaces and on
 * the standalone game routes — and there a `0px` fallback would put content
 * under the home indicator.
 *
 * Fallback, not addition: whichever of the two is present carries the inset and
 * they are never both counted. That is the whole trick, and it is the part that
 * gets lost when the expression is retyped.
 *
 * ── Adopted at one site so far, and that is stated rather than implied ──────
 *
 * This is extracted honestly, not aspirationally. Three inline copies of the
 * same calc predate it and still stand:
 *
 *   · `GameLifecycleActions.tsx` (+24) — the shared finalize/correct CTA
 *   · `CompetitionFace.tsx` (+16)      — the game-panel scroll wrapper
 *   · `AppShell.tsx` (+16)             — the shell's own content inset
 *
 * They are not converted here because this change is a bug fix on one surface
 * and those three serve surfaces it cannot verify. #1312 is the unification,
 * and it also carries the structural reason stroke was missed here at all.
 */
export function bottomNavInset(extraPx: number): string {
  return `calc(var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px)) + ${extraPx}px)`;
}
