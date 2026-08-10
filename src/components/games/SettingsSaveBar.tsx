"use client";

import { useState } from "react";

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
 *
 * **The one exception is `stayOpenOnSave`** — see its prop note. When a save keeps the
 * panel open, the bar must say so and offer a way out, because the muscle memory built by
 * every other save is that Save exits: the ghost button becomes **Done** and a short line
 * confirms the write. Leaving it as a silently-still-open panel with a greyed-out Save
 * would read as a failure, which is the opposite of what happened.
 */
export function SettingsSaveBar({
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  onLeave,
  saveDisabledReason,
  stayOpenOnSave = false,
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
  /** When set, Save is BLOCKED (disabled) and this reason shows as an amber hint —
   *  e.g. a points distribution that no longer sums to the total (C1). Distinct from
   *  `error`, which is a RED post-save failure. Cancel stays enabled (you can leave). */
  saveDisabledReason?: string | null;
  /**
   * This save changes something whose effect is OUTSIDE the panel, so a landed
   * save must not close. Exactly one field qualifies today — the Setup/Scoring
   * toggle, which decides the surface the panel is covering — and the flag is
   * computed once in `useConfigDraft` (`stayOpenOnSave`) and passed straight
   * through, so the four views cannot compute it four ways.
   *
   * Read at CLICK time: the `.then` closure below captures this render's value,
   * which is what we want — `reset(true)` clears the difference during the await,
   * so re-reading it afterwards would always say false.
   */
  stayOpenOnSave?: boolean;
}) {
  const blocked = !!saveDisabledReason;
  // A save landed and deliberately did NOT close the panel. Local because it is
  // pure presentation — nothing outside this bar needs to know.
  //
  // It is never cleared, and does not need to be: both readers below AND it with
  // `!dirty`, so the moment the user edits again the confirmation hides and the
  // ghost button goes back to "Cancel" on its own. (An effect clearing it on
  // `dirty` was the first version; it is redundant, and the React Compiler lint
  // rightly refuses `setState` inside an effect.)
  const [savedInPlace, setSavedInPlace] = useState(false);

  return (
    <div data-testid="settings-save-bar">
      {blocked && dirty && !saving && (
        <p
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: "var(--color-bt-warning-faint)", border: "1px solid var(--color-bt-warning-border)", color: "var(--color-bt-warning)" }}
          data-testid="settings-save-blocked"
        >
          {saveDisabledReason}
        </p>
      )}
      {error && (
        <p
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: "var(--color-bt-danger-faint)", border: "1px solid var(--color-bt-danger-border)", color: "var(--color-bt-danger)" }}
          data-testid="settings-save-error"
        >
          {error}
        </p>
      )}
      {/* The stayed-open confirmation. Without it the panel just sits there with a
          greyed-out Save, which reads as "the save failed" — the exact opposite of
          what happened. Names the write AND the way out. */}
      {savedInPlace && !dirty && !saving && !error && (
        <p
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)", color: "var(--color-bt-accent)" }}
          data-testid="settings-saved-in-place"
        >
          Saved. Close to see the game.
        </p>
      )}
      {/* Cancel (Ghost, auto-width, left) + Save (Primary, fills) — full width, crew/lodging.
          No dirty/saving status line (matching the trip modals): the Save button already
          reads "Saving…" mid-write, and a landed save closes the panel. */}
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
          {/* After a stayed-open save the draft is clean, so this button's
              discard is a no-op and all it does is leave — which is what the
              user now needs and what "Cancel" would misdescribe. */}
          {savedInPlace && !dirty ? "Done" : "Cancel"}
        </button>
        <button
          type="button"
          onClick={() => {
            void onSave().then((ok) => {
              if (!ok) return;
              if (stayOpenOnSave) setSavedInPlace(true);
              else onLeave();
            });
          }}
          disabled={!dirty || saving || blocked}
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
