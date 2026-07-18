"use client";

/**
 * SettingsSaveBar — the settings page's ONE commit affordance (Draft-Then-Save P1
 * §2.7), shared across every format's settings page (match extracted it here in P2 so
 * non-golf/rack/stroke reuse the SAME bar rather than re-implementing it).
 *
 * Rendered in the settings slide-over's PINNED BOTTOM footer (SettingsSlideOver) — the
 * crew/lodging commit idiom — so it's always in reach without hunting the top of a long
 * scroll. Save is **Primary** and Cancel is **Ghost** (STYLE_GUIDE §5, inline-styled —
 * the repo has no shared <Button>). Save is disabled until the draft actually differs
 * from the frozen baseline, so it can't fire a no-op write. (This is a plain row now —
 * the shell's footer owns the border/padding/background.)
 *
 * On failure the panel STAYS open, the draft is kept, and the reason renders here
 * legibly — the RPC's readiness assert (PRECONDITION_FAILED "finish setting up this
 * game…"), the optimistic-concurrency CONFLICT, and the course/matches/groupings freeze
 * all arrive as real sentences, so the banner names what to fix.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  justSaved,
  error,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  /** A Save actually landed this session — the ONLY state that may claim one did. */
  justSaved: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  // "Clean" is not the same claim as "saved". Cancel DISCARDS the draft and lands clean,
  // and an untouched page is clean too — neither wrote anything, so neither may say so.
  // Only a landed Save earns "Saved"; otherwise the label says nothing rather than
  // something false.
  const hint = saving ? "Saving…" : dirty ? "Unsaved changes" : justSaved ? "Saved" : "";
  return (
    <div data-testid="settings-save-bar">
      {error && (
        <p
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: "var(--color-bt-danger-faint)", border: "1px solid var(--color-bt-danger-border)", color: "var(--color-bt-danger)" }}
          data-testid="settings-save-error"
        >
          {error}
        </p>
      )}
      <div className="flex items-center gap-2.5">
        <span className="flex-1 truncate text-[12.5px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="settings-dirty-hint">
          {hint}
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={!dirty || saving}
          className="disabled:opacity-40"
          style={{
            height: 38,
            padding: "0 14px",
            borderRadius: 12,
            background: "transparent",
            color: "var(--color-bt-text-dim)",
            border: "0.5px solid var(--color-bt-border)",
            fontSize: 14,
            fontWeight: 600,
          }}
          data-testid="settings-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="disabled:opacity-40"
          style={{
            height: 38,
            padding: "0 18px",
            borderRadius: 12,
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            border: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
          data-testid="settings-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
