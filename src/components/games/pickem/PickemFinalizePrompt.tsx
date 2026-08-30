"use client";

import { createPortal } from "react-dom";

/**
 * The "some games have no result" confirm, asked at the moment of the decision.
 *
 * ── This REPLACES a persistent banner, and the reason is the better argument ─
 *
 * The first build put an amber note above the finalize button whenever contests
 * were outstanding. Two things were wrong with it.
 *
 * It was skippable. A block of colour that has been on screen for the whole
 * session stops being read, and the one moment it needed to be read was the tap
 * it sat above.
 *
 * And it was telling the runner to keep doing what they were already doing.
 * Somebody on the results screen is there to enter results; "2 games have no
 * result" is not news to them, it is the task. A standing warning that restates
 * the task is noise for the entire time it is up, and it only becomes
 * information at the instant somebody tries to stop early.
 *
 * So the question moves to the tap, where it cannot be skipped and where it is
 * genuinely a question.
 *
 * ── Warning, not danger ────────────────────────────────────────────────────
 *
 * Finalizing early is REVERSIBLE — Correct a result reopens the game and the
 * recompute is idempotent — so the confirm is warning-toned rather than
 * destructive-toned. `DiscardChangesPrompt` reserves the danger treatment for
 * the thing it destroys; nothing here is destroyed.
 *
 * The safe option still comes FIRST, following that component's convention: the
 * runner reached this dialog by tapping the primary CTA, so the likely reason
 * they are reading it at all is that they had not finished.
 *
 * ── Portaled for the same reason `DiscardChangesPrompt` is ─────────────────
 *
 * It is rendered from inside the game panel's z-30 stacking context, which would
 * otherwise cap it below the body-portaled shell. See that file for the full
 * note; this is the same mechanism, not a second decision.
 */
export function PickemFinalizePrompt({
  /** The sentence, built by `unresolvedWarning` so this and any other reader of
   *  the same fact cannot word it differently. */
  message,
  pending,
  onConfirm,
  onCancel,
}: {
  message: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
      data-testid="pickem-finalize-prompt"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{
          maxWidth: 340,
          background: "var(--color-bt-card-float)",
          borderRadius: 18,
          padding: 18,
        }}
      >
        <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--color-bt-text)" }}>
          Some games have no result
        </div>
        <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          {message}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="w-full"
            style={{
              height: 44,
              borderRadius: 12,
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent)",
              border: "none",
              fontSize: 14.5,
              fontWeight: 600,
            }}
            data-testid="pickem-finalize-prompt-cancel"
          >
            Keep entering results
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="w-full disabled:opacity-40"
            style={{
              height: 44,
              borderRadius: 12,
              background: "transparent",
              color: "var(--color-bt-warning)",
              border: "0.5px solid var(--color-bt-warning-border)",
              fontSize: 14.5,
              fontWeight: 600,
            }}
            data-testid="pickem-finalize-prompt-confirm"
          >
            {pending ? "Saving results…" : "Save results anyway"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
