"use client";

import { useEffect, useState } from "react";
import type { SaveState } from "@/lib/configDraft";

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
 * Exit behaviour: BOTH bottom buttons CLOSE the panel (like the trip modals), so
 * neither leaves you "closed but still on the page":
 *  - **Cancel is ALWAYS enabled** — it means "leave." `onDiscard` discards the draft and
 *    closes (a no-op reset when clean). Disabled only mid-save.
 *  - **Save is disabled until dirty** — `onSave` commits and returns whether it LANDED;
 *    on success the bar calls `onLeave` to close, on failure the panel stays open with
 *    the inline error below (readiness / concurrency CONFLICT / course-matches-groupings
 *    freeze all arrive as real sentences here).
 *
 * A LANDED SAVE ALWAYS CLOSES — including the Setup/Scoring flip, which used to be an
 * exception (`stayOpenOnSave`) paired with a "Saved. Close to see the game" hint. That
 * accommodation existed because editing a setting on an in-progress game meant
 * enter → change → save (which closed) → reopen. That requirement is gone: the only
 * remaining restriction is that scoring can't start without matches set, and that is
 * enforced SERVER-side (`save_game_config`'s `NOT_READY`, and `assertGameReady` behind
 * `games.enableScoring` / `matches.enableScoring`) — neither of which knows this panel
 * exists. A refused flip still returns `ok === false` and still holds the panel open
 * with its error, so removing the exception cannot hide a refusal.
 *
 * ── The bar says WHY it is disabled (#1255) ──────────────────────────────────────────
 * It used to take `dirty: boolean`, which collapsed three unrelated facts into one grey
 * button: nothing changed, not known yet, and will-be-refused were indistinguishable.
 * It now takes `saveState` (the lifecycle, from `useConfigDraft`) and layers
 * `saveDisabledReason` (the content refusal, from the view) over it — see `saveHintFor`.
 */

/** How long `not-ready` must persist before the bar says anything about it.
 *
 *  The load window is normally sub-second and invisible, and a notice on every settings
 *  open would be worse than the silence it replaces — so the hint is for the case that
 *  DOESN'T clear, which is the one that cost an evening. Long enough that a healthy open
 *  never shows it; short enough that someone staring at a dead button gets an answer
 *  before they give up and text somebody. */
const NOT_READY_GRACE_MS = 1500;

/** Named so the wording is testable without rendering, and so the "reload" instruction
 *  can't drift from the state that warrants it. It NAMES AN ACTION (CLAUDE.md) — that is
 *  the whole point of the issue this came from. */
export const NOT_READY_HINT =
  "Still loading this game's settings. If Save doesn't turn on shortly, reload the page.";

/** The last-resort string for a `saveState` this bar doesn't know. Unreachable today —
 *  `saveHintFor`'s `never` check fails the BUILD first — but a silent grey button is the
 *  exact defect being fixed, so the runtime fallthrough says something rather than
 *  nothing. Belt and braces, deliberately. */
export const UNKNOWN_STATE_HINT = "Save isn't available right now.";

export type SaveHint = { text: string; tone: "warning" | "quiet" } | null;

/**
 * The ONE mapping from (lifecycle state, content refusal) → what the bar says.
 *
 * Exported and pure so the wording is unit-testable without a DOM, and so there is one
 * place to read rather than a chain of ternaries inside JSX.
 *
 * A refusal OUTRANKS readiness, and it is no longer gated on `dirty`. It used to be
 * (`blocked && dirty`), which meant the explanation appeared only once you had already
 * edited — so a page that would refuse your save told you so only after you'd done the
 * work. Saying it on open is the actionable order.
 */
export function saveHintFor(
  saveState: SaveState,
  saveDisabledReason: string | null | undefined,
  notReadyElapsed: boolean,
): SaveHint {
  if (saveDisabledReason) return { text: saveDisabledReason, tone: "warning" };
  switch (saveState) {
    case "ready":
      return null;
    case "clean":
      // Nothing to save is self-evident from having changed nothing. Words here would be
      // noise on every open, which is how a hint stops being read at all.
      return null;
    case "not-ready":
      // "Not known yet", never "you can't" — and only after the grace period.
      return notReadyElapsed ? { text: NOT_READY_HINT, tone: "quiet" } : null;
    default: {
      // Exhaustiveness: a new `SaveState` member fails the build HERE rather than
      // falling through to silence, which is the defect #1255 is about.
      const exhaustive: never = saveState;
      void exhaustive;
      return { text: UNKNOWN_STATE_HINT, tone: "quiet" };
    }
  }
}

export function SettingsSaveBar({
  saveState,
  saving,
  error,
  onSave,
  onDiscard,
  onLeave,
  saveDisabledReason,
}: {
  /** Why Save is (or isn't) available — the draft lifecycle, from `useConfigDraft`. */
  saveState: SaveState;
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
}) {
  const blocked = !!saveDisabledReason;

  // Has `not-ready` outlasted the grace period?
  //
  // Both writes are deferred — one to the timer, one to CLEANUP — so nothing sets state
  // in the effect body (`react-hooks/set-state-in-effect`, which CI enforces at
  // --max-warnings 0). The cleanup runs on every `saveState` transition and on unmount,
  // which is exactly when the clock should be thrown away: a later stall then starts its
  // own grace period instead of inheriting a spent one and flashing the hint instantly.
  const [notReadyElapsed, setNotReadyElapsed] = useState(false);
  useEffect(() => {
    if (saveState !== "not-ready") return;
    const t = setTimeout(() => setNotReadyElapsed(true), NOT_READY_GRACE_MS);
    return () => {
      clearTimeout(t);
      setNotReadyElapsed(false);
    };
  }, [saveState]);

  // Mid-save the button already reads "Saving…" — a second explanation underneath it is
  // noise, so the hint yields to it.
  const hint = saving ? null : saveHintFor(saveState, saveDisabledReason, notReadyElapsed);

  return (
    <div data-testid="settings-save-bar">
      {hint && (
        <p
          className="mb-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug"
          style={
            hint.tone === "warning"
              ? {
                  background: "var(--color-bt-warning-faint)",
                  border: "1px solid var(--color-bt-warning-border)",
                  color: "var(--color-bt-warning)",
                }
              : // QUIET: dim body text, no fill, no border. A load window is not a
                // refusal and must not be dressed as one — warning chrome here would
                // report a problem where there is only a wait.
                { color: "var(--color-bt-text-dim)" }
          }
          data-testid={hint.tone === "warning" ? "settings-save-blocked" : "settings-save-pending"}
        >
          {hint.text}
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
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void onSave().then((ok) => {
              // A landed save always closes. A failed save returns false and
              // leaves the panel open with its inline error above.
              if (ok) onLeave();
            });
          }}
          disabled={saveState !== "ready" || saving || blocked}
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
