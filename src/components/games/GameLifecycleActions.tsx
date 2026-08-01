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
export function GameLifecycleActions({
  finalizeLabel,
  finalizePendingLabel,
  finalizePending = false,
  correctPending = false,
  onFinalize,
  onCorrect,
  ...lifecycleInput
}: GameLifecycleInput & {
  /** e.g. "Finish round" (stroke) / "Lock the result" (rack). */
  finalizeLabel: string;
  /** e.g. "Finishing…" / "Locking…". */
  finalizePendingLabel: string;
  finalizePending?: boolean;
  correctPending?: boolean;
  onFinalize: () => void;
  /** Re-lock reuses `onFinalize` — `games.finish` clears `corrections_open` either way. */
  onCorrect: () => void;
}) {
  const state = gameLifecycle(lifecycleInput);

  // Primary — first finalize.
  if (state.canFinalize) {
    return (
      <div className="px-4 pb-6" data-testid="game-finalize">
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
      <div className="px-4 pb-6" data-testid="game-correct">
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
      <div className="px-4 pb-6" data-testid="game-relock">
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
          {finalizePending ? "Re-locking…" : "Re-lock result"}
        </button>
      </div>
    );
  }

  return null;
}
