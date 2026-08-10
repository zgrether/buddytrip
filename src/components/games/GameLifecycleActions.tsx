"use client";

import { gameLifecycle, type GameLifecycleInput } from "@/lib/gameLifecycle";

/**
 * GameLifecycleActions — the finalize / correct / re-lock CTAs at the bottom of a
 * golf game's scoreboard, for every format.
 *
 * Pairs with `src/lib/gameLifecycle.ts`: that module decides WHICH action is
 * offered, this one renders it. Both rack and stroke render this; neither owns a
 * copy of the conditions any more. Before this, each view carried its own inline
 * blocks, and stroke's copy was missing the correction arm entirely (#769) — a
 * finalized stroke game had no way back, which is also why the one field
 * reproduction of #776 could not be re-finalized from the UI.
 *
 * **Persistence-agnostic** per CLAUDE.md #7 — no tRPC, no DB, no auth. The parent
 * owns the mutations and passes handlers plus pending flags.
 *
 * **Anchoring** (CLAUDE.md #14): this renders at the end of the scoreboard's own
 * scroll content, matching what rack and stroke both already did. It is NOT one
 * of the focused in-round bottom controls that must anchor to the viewport — a
 * scoreboard is a short, scrollable summary, not a per-hole entry surface.
 */
/**
 * Bottom clearance for all three CTA arms.
 *
 * These render at the END of the scoreboard's scroll content — deliberately, per
 * the anchoring note above — which means nothing reserves space for the bottom tab
 * bar underneath them. A flat `pb-6` (24px) left the button sitting almost against
 * the nav.
 *
 * `--bt-bottomnav-height` is published by `AppTabBar` for exactly this ("so
 * bottom-anchored surfaces can clear the bar"), so the clearance tracks the real
 * rendered height — including its safe-area inset — instead of a number that goes
 * stale when the bar changes. It falls back to 0px where the bar isn't mounted (the
 * standalone game routes, desktop), leaving the original 24px on its own.
 *
 * ONE constant on the shared component: all four formats route their finalize /
 * correct / save-changes CTAs through here, so this is fixed once for every
 * affected surface rather than per view.
 */
const CTA_BOX: React.CSSProperties = {
  /**
   * The fallback is `env(safe-area-inset-bottom)`, NOT `0px`, and the difference
   * only started mattering when `viewport-fit=cover` landed.
   *
   * `--bt-bottomnav-height` is `AppTabBar`'s measured `offsetHeight`, which
   * already INCLUDES its own safe-area padding — so where the bar is showing,
   * adding `env()` on top would double-count the inset and leave a visible gap.
   * But `AppTabBar` REMOVES the variable when it unmounts, and it unmounts on
   * exactly the focused-entry surfaces where this CTA anchors to the viewport
   * bottom. There the fallback is what applies, and a `0px` fallback would put
   * the button under the home indicator.
   *
   * Fallback, not addition — that is the whole trick: whichever of the two is
   * present carries the inset, and they are never both counted.
   */
  paddingBottom: "calc(var(--bt-bottomnav-height, env(safe-area-inset-bottom, 0px)) + 24px)",
};

export function GameLifecycleActions({
  finalizeLabel = "Save results",
  finalizePendingLabel = "Saving results…",
  finalizePending = false,
  correctPending = false,
  onFinalize,
  onCorrect,
  ...lifecycleInput
}: GameLifecycleInput & {
  /**
   * The finalize CTA. One string across all four formats since the vocabulary
   * sweep, so it is the DEFAULT rather than something each caller repeats — all
   * four passed the identical literal, which is four chances for a fifth format
   * to differ by accident instead of by decision. Still a prop: a format that
   * genuinely needs different words can say so, and now that is visible as an
   * override rather than hidden among four copies of the same string.
   */
  finalizeLabel?: string;
  /** e.g. "Saving results…". */
  finalizePendingLabel?: string;
  finalizePending?: boolean;
  correctPending?: boolean;
  onFinalize: () => void;
  /** "Save scoring changes" reuses `onFinalize` — `games.finish` clears
   *  `corrections_open` either way. */
  onCorrect: () => void;
}) {
  const state = gameLifecycle(lifecycleInput);

  // Primary — first finalize.
  if (state.canFinalize) {
    return (
      <div className="px-4" style={CTA_BOX} data-testid="game-finalize">
        <button
          onClick={onFinalize}
          disabled={finalizePending}
          className="w-full disabled:opacity-40"
          style={{
            height: 50,
            borderRadius: 12,
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-on-accent)",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {finalizePending ? finalizePendingLabel : finalizeLabel}
        </button>
      </div>
    );
  }

  // The deliberate, auditable correction path (owner / co-admin / delegate).
  // Secondary styling: reopening a locked result is not the encouraged action.
  if (state.canCorrect) {
    return (
      // `pt-4`, unlike the finalize arm above. Before finalize this block follows
      // the entry surface, which ends in its own spacing; after it the results
      // land directly above and the button butted straight against them. The
      // post-finalize arms need the gap the pre-finalize one gets for free.
      <div className="px-4 pt-4" style={CTA_BOX} data-testid="game-correct">
        <button
          onClick={onCorrect}
          disabled={correctPending}
          className="w-full disabled:opacity-40"
          style={{
            height: 48,
            borderRadius: 12,
            background: "transparent",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {correctPending ? "Opening…" : "Correct a score"}
        </button>
      </div>
    );
  }

  // Re-lock — warning-toned, because the game is currently OPEN and its result is
  // not counting as final until this is tapped.
  if (state.canRelock) {
    return (
      // Same post-finalize context as the correct arm above — same top padding.
      <div className="px-4 pt-4" style={CTA_BOX} data-testid="game-relock">
        <button
          onClick={onFinalize}
          disabled={finalizePending}
          className="w-full disabled:opacity-40"
          style={{
            height: 50,
            borderRadius: 12,
            background: "var(--color-bt-warning)",
            color: "var(--color-bt-on-accent)",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {finalizePending ? "Saving changes…" : "Save scoring changes"}
        </button>
      </div>
    );
  }

  return null;
}
