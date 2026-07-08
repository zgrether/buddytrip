import { Check } from "lucide-react";

/**
 * Checkbox — the app's custom checkbox: a teal-filled box with a dark check when
 * on, a bordered empty box when off. Renders only the box (the `label` is the
 * a11y name); callers place their own visible label alongside it. Extracted from
 * ModifierCards so game modifiers and the scorecard tee legend share one control
 * instead of a native `<input type="checkbox">`.
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
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${className}`}
      style={{
        background: on ? "var(--color-bt-accent)" : "transparent",
        border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
      }}
    >
      {on && <Check size={13} strokeWidth={3} style={{ color: "var(--color-bt-on-accent)" }} />}
    </button>
  );
}
