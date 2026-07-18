"use client";

import { Plus, Minus } from "lucide-react";

/**
 * Stepper — the ONE canonical −/+ number control (W-GAMEPAGE visual pass P-B;
 * vocabulary §6). Replaces four bespoke step-buttons (PointStepper, HandicapRoster,
 * ModifierCards, RelHandicapControl) with a single component in three densities.
 *
 * Look (§6): buttons are **transparent, thin-bordered rounded-squares** (NOT filled
 * circles) with muted glyphs; the number is **bold 700**; an optional small-caps
 * label sits beneath. `−`/`+` disable-style at the floor/ceiling (opacity, no color
 * change).
 *
 * Value handling — covers all four migrated call sites without changing behavior:
 *   - `onChange(next)` — the Stepper clamps `value ± step` into `[min, max]` and
 *     emits the next value (the value-owning consumers).
 *   - `onIncrement` / `onDecrement` — delta callbacks the PARENT owns (preferred
 *     when present). Needed for HandicapRoster's rapid-tap pending-ref logic and
 *     RelHandicapControl's sign-aware `step`, where the parent computes the next
 *     value itself. `min`/`max` still drive the disabled state.
 *   - `formatValue` — display override (default `String`); the roster renders 0 as
 *     "SCR", the match-play control renders "—" when even.
 */

export type StepperSize = "full" | "compact" | "inline";

export const STEPPER_SIZES: Record<StepperSize, { btn: number; num: number; gap: number; align: "center" | "right" }> = {
  full: { btn: 40, num: 25, gap: 16, align: "center" },
  compact: { btn: 30, num: 18, gap: 10, align: "center" },
  inline: { btn: 32, num: 20, gap: 12, align: "right" },
};

/** The clamp + disabled logic, pure so migration-equivalence is unit-testable
 *  apart from render. `−` disables at the floor, `+` at the ceiling (if any). */
export function stepperBounds(value: number, min: number, max?: number, step = 1) {
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  return {
    atFloor: value <= min,
    atCeil: max != null && value >= max,
    decValue: clamp(value - step),
    incValue: clamp(value + step),
  };
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  onIncrement,
  onDecrement,
  size,
  label,
  disabled = false,
  formatValue = String,
  dimValue = false,
  align,
  testId,
}: {
  value: number;
  min: number;
  max?: number;
  step?: number;
  onChange?: (next: number) => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
  size: StepperSize;
  /** Optional small-caps label beneath the number (§6). */
  label?: string;
  disabled?: boolean;
  /** Display override — default String(value). Roster → "SCR" at 0, etc. */
  formatValue?: (n: number) => string;
  /** Render the value in a smaller, muted treatment instead of the bold primary number —
   *  for a "default/empty" reading (the handicap roster's "SCR" scratch state) rather than
   *  a set value that should read boldly. Default false (the bold number). */
  dimValue?: boolean;
  /** Override the size's default alignment (center vs right-justified). */
  align?: "center" | "right";
  testId?: string;
}) {
  const dims = STEPPER_SIZES[size];
  const justify = (align ?? dims.align) === "right" ? "flex-end" : "center";

  const b = stepperBounds(value, min, max, step);
  const dec = () => (onDecrement ? onDecrement() : onChange?.(b.decValue));
  const inc = () => (onIncrement ? onIncrement() : onChange?.(b.incValue));

  return (
    <div className="flex items-center" style={{ gap: dims.gap, justifyContent: justify }} data-testid={testId}>
      <StepBtn dir="dec" px={dims.btn} disabled={disabled || b.atFloor} onClick={dec} />
      <div className="flex flex-col items-center" style={{ minWidth: dims.num + 14 }}>
        <span
          style={
            dimValue
              ? { fontSize: 13, fontWeight: 500, lineHeight: 1, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }
              : { fontSize: dims.num, fontWeight: 700, lineHeight: 1, color: "var(--color-bt-text)", fontVariantNumeric: "tabular-nums" }
          }
        >
          {formatValue(value)}
        </span>
        {label && (
          <span className="mt-1" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
            {label}
          </span>
        )}
      </div>
      <StepBtn dir="inc" px={dims.btn} disabled={disabled || b.atCeil} onClick={inc} />
    </div>
  );
}

/** The shared step button (§6): transparent, thin-bordered rounded-square, muted glyph. */
function StepBtn({ dir, px, disabled, onClick }: { dir: "inc" | "dec"; px: number; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "inc" ? "Increase" : "Decrease"}
      className="flex flex-shrink-0 items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ width: px, height: px, borderRadius: 9, background: "transparent", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
    >
      {dir === "inc" ? <Plus size={Math.round(px * 0.42)} /> : <Minus size={Math.round(px * 0.42)} />}
    </button>
  );
}
