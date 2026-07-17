"use client";

import type { LucideIcon } from "lucide-react";

/**
 * SegmentedToggle — the ONE segmented two-state control (Settings polish). Entry Mode
 * and Game State share it so they can't drift into two lookalikes. Both segments are
 * equally weighted: the active one gets a neutral recessed treatment (base surface +
 * border), NOT the teal Primary-button fill — teal reads as a CTA (STYLE_GUIDE §5),
 * which a state toggle must not (it isn't an action to take, it's a state to show).
 *
 * Per-option `disabled` (with an optional leading `icon`, e.g. a lock) covers the
 * Game State "Scoring" segment that's unavailable until the game is ready; a top-level
 * `disabled` freezes the whole control (a locked row / a save in flight).
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Segment unavailable (e.g. Scoring before the game is ready). */
  disabled?: boolean;
  /** Leading glyph (e.g. a lock on a not-ready segment). */
  icon?: LucideIcon;
  testId?: string;
}

export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  testId,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Freeze the whole control (locked row / pending save). */
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="inline-flex"
      style={{ gap: 4, padding: 4, borderRadius: 10, background: "var(--color-bt-card-raised)" }}
      data-testid={testId}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const segDisabled = disabled || !!opt.disabled;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => { if (!segDisabled && !active) onChange(opt.value); }}
            disabled={segDisabled}
            className="flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed"
            style={{
              background: active ? "var(--color-bt-base)" : "transparent",
              color: active ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
              border: active ? "1px solid var(--color-bt-border)" : "1px solid transparent",
              opacity: segDisabled && !active ? 0.6 : 1,
            }}
            data-testid={opt.testId}
          >
            {Icon && <Icon size={12} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
