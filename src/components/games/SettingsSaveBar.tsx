"use client";

/**
 * SettingsSaveBar — the settings page's ONE commit affordance (Draft-Then-Save P1
 * §2.7), shared across every format's settings page (match extracted it here in P2 so
 * non-golf/rack/stroke reuse the SAME bar rather than re-implementing it).
 *
 * Rendered in the settings slide-over's PINNED BOTTOM footer (SettingsSlideOver) — the
 * crew/lodging commit idiom. Layout MATCHES the trip-settings modals: **Cancel
 * left-justified (Ghost, auto-width); Save fills the remaining space (Primary)** — a
 * full-width two-button row (STYLE_GUIDE §5, inline-styled — the repo has no shared
 * <Button>).
 *
 * Exit-behavior alignment: BOTH bottom buttons now CLOSE the panel (like the trip modals),
 * so neither leaves you "closed but still on the page":
 *  - **Cancel is ALWAYS enabled** — it means "leave." `onDiscard` discards the draft and
 *    closes (a no-op reset when clean). Disabled only mid-save.
 *  - **Save is disabled until dirty** — `onSave` commits and returns whether it LANDED; on
 *    success the bar calls `onLeave` to close, on failure the panel stays open with the
 *    inline error below (readiness / concurrency CONFLICT / course-matches-groupings freeze
 *    all arrive as real sentences here). No "Saved" hint any more — a landed save closes.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  onLeave,
}: {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** Commit the draft; resolves `true` only when the write LANDED. */
  onSave: () => Promise<boolean>;
  /** Cancel = discard the draft + close the panel (the "leave" action). */
  onDiscard: () => void;
  /** Close the panel after a successful Save (the draft is already clean). */
  onLeave: () => void;
}) {
  const hint = saving ? "Saving…" : dirty ? "Unsaved changes" : "";
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
      {/* Dirty/saving status — a quiet line above the button row (the trip modals have no
          such hint, but the E2E + the user lean on "Unsaved changes"; "Saved" is gone
          because a landed save closes the panel). */}
      {hint && (
        <p className="mb-1.5 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="settings-dirty-hint">
          {hint}
        </p>
      )}
      {/* Cancel (Ghost, auto-width, left) + Save (Primary, fills) — full width, crew/lodging. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="disabled:opacity-40"
          style={{
            height: 40,
            padding: "0 16px",
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
          onClick={() => { void onSave().then((ok) => { if (ok) onLeave(); }); }}
          disabled={!dirty || saving}
          className="flex-1 disabled:opacity-40"
          style={{
            height: 40,
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
