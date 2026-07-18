"use client";

import { createPortal } from "react-dom";

/**
 * DiscardChangesPrompt (P1.7) — the confirm-on-leave gate, shared across every
 * draft-then-save game settings surface (match / non-golf / rack / stroke).
 *
 * Draft-then-save moved the whole settings page onto ONE draft, which turned a
 * back-press into a silent data-loss path (the old per-row persistence meant leaving
 * could never lose anything). This offers the way OUT of that: Save what you did,
 * keep editing, or explicitly throw it away.
 *
 * Discard is the DANGER action and it is never the default — the safe options come
 * first, and the destructive one is styled as destructive (STYLE_GUIDE §5), because
 * the thing it destroys is the user's unsaved work.
 */
export function DiscardChangesPrompt({
  onDiscard,
  onKeepEditing,
  onSave,
  saving,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  // Portaled to body: the shell it guards is itself body-portaled at z-50, and this
  // prompt (rendered by the game view, inside the z-30 panel) would otherwise be
  // z-capped by the panel's stacking context and land UNDER the shell. z-[60] beats
  // the shell once both live at the body level.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onKeepEditing}
      data-testid="discard-changes-prompt"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ maxWidth: 340, background: "var(--color-bt-card-float)", borderRadius: 18, padding: 18 }}
      >
        <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--color-bt-text)" }}>Unsaved changes</div>
        <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          Your changes to this game haven’t been saved yet. Leaving now discards them.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="w-full disabled:opacity-40"
            style={{ height: 44, borderRadius: 12, background: "var(--color-bt-accent)", color: "var(--color-bt-base)", border: "none", fontSize: 14.5, fontWeight: 600 }}
            data-testid="discard-prompt-save"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={onKeepEditing}
            className="w-full"
            style={{ height: 44, borderRadius: 12, background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "0.5px solid var(--color-bt-border)", fontSize: 14.5, fontWeight: 600 }}
            data-testid="discard-prompt-keep"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="w-full"
            style={{ height: 44, borderRadius: 12, background: "transparent", color: "var(--color-bt-danger)", border: "0.5px solid var(--color-bt-danger-border)", fontSize: 14.5, fontWeight: 600 }}
            data-testid="discard-prompt-discard"
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
