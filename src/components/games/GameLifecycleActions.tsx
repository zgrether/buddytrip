"use client";

import { TYPE_SCALE } from "@/lib/typeScale";
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

/**
 * ── WHERE THE ARMS SIT, AND HOW LOUD THE FIRST ONE IS ─────────────────────
 *
 * Two presentation props, both added for pick'em, both deliberately HERE rather
 * than as a private button on that surface.
 *
 * CLAUDE.md #24's eighth incident was match rendering its own copy of this
 * markup, agreeing with the shared component only by coincidence of nobody
 * having changed either side. Its second shape is the one in play now: the
 * STATE is already unified and the PRESENTATION gets re-rendered privately.
 * Pick'em needs different chrome, not different conditions — so the chrome
 * becomes a variant and `gameLifecycle` stays the only thing deciding which arm
 * appears.
 *
 * `variant: "panel"` — the arm sits in a row of standing controls (pick'em's
 * runner panel) rather than at the end of a scroll surface. No `CTA_BOX`: that
 * clearance exists because a bottom-anchored CTA has a tab bar under it, and a
 * button inside a card at the top of the page has nothing to clear.
 *
 * `quiet` — the finalize arm loses its fill. Golf cannot use this: `canFinalize`
 * already requires `allComplete` there, so the button only exists once the work
 * is done. Pick'em's completeness input is the CLOCK rather than the results
 * (a postponed Tuesday game must not hold the cup open), so its finalize is
 * offered while contests are still unmarked — and a full-weight primary is the
 * wrong thing to put in front of somebody mid-way through a list.
 */
export function GameLifecycleActions({
  finalizeLabel = "Save results",
  finalizePendingLabel = "Saving results…",
  correctLabel = "Correct a score",
  finalizePending = false,
  correctPending = false,
  variant = "cta",
  quiet = false,
  onFinalize,
  onCorrect,
  ...lifecycleInput
}: GameLifecycleInput & {
  /** Where this renders. See the note above. */
  variant?: "cta" | "panel";
  /**
   * Offer the finalize without the fill — the action is available and is not
   * being urged. See the note above for why only pick'em passes it.
   */
  quiet?: boolean;
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
  /**
   * The correction CTA's words. A DEFAULT for the same reason `finalizeLabel` is
   * one — four golf formats say "Correct a score" and should not each repeat the
   * literal — but pick'em has no scores: its runner corrects a RESULT, which is
   * the word every other control on that screen uses. An override that is
   * visible as a decision beats a fifth copy of a string that is wrong there.
   */
  correctLabel?: string;
  finalizePending?: boolean;
  correctPending?: boolean;
  onFinalize: () => void;
  /** "Save scoring changes" reuses `onFinalize` — `games.finish` clears
   *  `corrections_open` either way. */
  onCorrect: () => void;
}) {
  const state = gameLifecycle(lifecycleInput);
  const panel = variant === "panel";

  /**
   * The wrapper each arm sits in. `pt` is the gap the two post-finalize arms
   * need and the first one gets for free from the surface above it — see the
   * correct arm's own note. Both are irrelevant in the panel variant, which is
   * one control in a row that already spaces itself.
   */
  /**
   * The wrapper each arm sits in.
   *
   * THE TOP GAP IS UNCONDITIONAL NOW, and the comment it replaces said why it
   * was not: "the gap the two post-finalize arms need and the first one gets
   * for free from the surface above it". The finalize arm therefore had none —
   * and on three surfaces the gap was not there to inherit, so "Save results"
   * sat flush against the last card. Reported from a device on the outcome
   * match view, Stableford and the pick'em runner.
   *
   * A control that depends on what happens to be above it is a per-surface
   * question forever. The gap belongs to the control.
   *
   * Still irrelevant in the panel variant, which is one control in a row that
   * already spaces itself.
   */
  const box = (testId: string, children: React.ReactNode) =>
    panel ? (
      <div className="shrink-0" data-testid={testId}>
        {children}
      </div>
    ) : (
      <div className="px-4 pt-4" style={CTA_BOX} data-testid={testId}>
        {children}
      </div>
    );

  /**
   * Sized to its label and 40px tall, matching the Start / Close picking button
   * it stands beside. A full-width primary is what made that panel read as a
   * call to action rather than as the runner's standing controls, and this
   * would undo it.
   */
  const PANEL_BTN = {
    minHeight: 40,
    borderRadius: 8,
    fontSize: TYPE_SCALE.bodyDense,
  } as const;

  // Primary — first finalize.
  if (state.canFinalize) {
    return box(
      "game-finalize",
      <button
        onClick={onFinalize}
        disabled={finalizePending}
        className={panel ? "shrink-0 px-4 disabled:opacity-40" : "w-full disabled:opacity-40"}
        style={{
          ...(panel ? PANEL_BTN : { height: 50, borderRadius: 12, fontSize: 15 }),
          /* Quiet takes the SECONDARY treatment already used by the correct arm
             below and by the panel's own non-primary move — a bordered
             transparent button — rather than a faded accent. A dimmed primary
             reads as disabled, and this one is not: it works, and pressing it
             will stop to ask about the games with no result. */
          background: quiet ? "transparent" : "var(--color-bt-accent)",
          border: quiet ? "1px solid var(--color-bt-border)" : "none",
          color: quiet ? "var(--color-bt-text)" : "var(--color-bt-on-accent)",
          /* 600 in the CTA variant, unchanged — the golf formats all render that
             one and none of them asked for a heavier button. 700 only in the
             panel, where it matches the Start / Close picking primary it
             stands beside. */
          fontWeight: panel && !quiet ? 700 : 600,
        }}
      >
        {finalizePending ? finalizePendingLabel : finalizeLabel}
      </button>
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
      // (Not in the panel variant, where the row does its own spacing.)
      box(
        "game-correct",
        <button
          onClick={onCorrect}
          disabled={correctPending}
          className={panel ? "shrink-0 px-4 disabled:opacity-40" : "w-full disabled:opacity-40"}
          style={{
            ...(panel ? PANEL_BTN : { height: 48, borderRadius: 12, fontSize: 14 }),
            background: "transparent",
            color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
            fontWeight: 600,
          }}
        >
          {correctPending ? "Opening…" : correctLabel}
        </button>
      )
    );
  }

  // Re-lock — warning-toned, because the game is currently OPEN and its result is
  // not counting as final until this is tapped.
  if (state.canRelock) {
    return (
      // Same post-finalize context as the correct arm above — same top padding.
      // (Not in the panel variant, where the row does its own spacing.)
      box(
        "game-relock",
        <button
          onClick={onFinalize}
          disabled={finalizePending}
          className={panel ? "shrink-0 px-4 disabled:opacity-40" : "w-full disabled:opacity-40"}
          style={{
            ...(panel ? PANEL_BTN : { height: 50, borderRadius: 12, fontSize: 15 }),
            background: "var(--color-bt-warning)",
            color: "var(--color-bt-on-accent)",
            fontWeight: 600,
          }}
        >
          {finalizePending ? "Saving changes…" : "Save scoring changes"}
        </button>
      )
    );
  }

  return null;
}
