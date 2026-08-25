import { Check } from "lucide-react";

/**
 * The BOX itself, with no interactivity — a `span`, so it can sit inside a row
 * that is the button.
 *
 * ── Why this is split out ───────────────────────────────────────────────────
 * A settings row where only the little box is tappable is a row with a 20px
 * target next to a 300px one that does nothing, and people reasonably tap the
 * words. Making the whole row the control means the row carries
 * `role="checkbox"` and the box becomes a picture of the state — and a `button`
 * inside a `button` is invalid HTML, so the visual half has to exist on its own.
 * (`SettingsRow` hit the same wall from the other direction and solved it by
 * making the two controls siblings; that works when they do DIFFERENT things,
 * and is wrong when they do the same thing.)
 *
 * ── The off-state border ────────────────────────────────────────────────────
 * `--color-bt-text-dim`, NOT `--color-bt-border`. In dark mode the border token
 * is `rgba(148, 163, 184, 0.18)`, which is tuned for separating surfaces — a
 * hairline you are not supposed to notice. On an unchecked control that is the
 * whole affordance, and at 18% alpha it is effectively invisible: reported from
 * a device as "I couldn't see the outline of the checkbox".
 *
 * A control's own outline is not chrome. The rule this follows: an interactive
 * affordance should be at least as visible as the secondary text beside it,
 * which is exactly what `--color-bt-text-dim` is. Fixed on the shared primitive
 * rather than at one call site, because it was equally invisible everywhere it
 * renders (game modifiers, the scorecard tee legend).
 */
export function CheckboxBox({
  on,
  className = "",
}: {
  on: boolean;
  /** Extra classes for caller-specific alignment (e.g. `mt-0.5`). */
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors ${className}`}
      style={{
        background: on ? "var(--color-bt-accent)" : "transparent",
        border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)"}`,
      }}
    >
      {on && <Check size={13} strokeWidth={3} style={{ color: "var(--color-bt-on-accent)" }} />}
    </span>
  );
}

/**
 * Checkbox — the app's custom checkbox: a teal-filled box with a dark check when
 * on, a bordered empty box when off. Renders only the box (the `label` is the
 * a11y name); callers place their own visible label alongside it. Extracted from
 * ModifierCards so game modifiers and the scorecard tee legend share one control
 * instead of a native `<input type="checkbox">`.
 *
 * Use this where the BOX is the target. Where a whole row should be tappable,
 * put `role="checkbox"` on the row and render `CheckboxBox` inside it instead —
 * see `NotificationsSheetBody`.
 */
export function Checkbox({
  on,
  onClick,
  label,
  disabled,
  className = "",
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  /** Extra classes for caller-specific alignment (e.g. `mt-0.5`). */
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex flex-shrink-0 disabled:opacity-40"
    >
      <CheckboxBox on={on} className={className} />
    </button>
  );
}
