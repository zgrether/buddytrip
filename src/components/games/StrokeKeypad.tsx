"use client";

import { Delete, Check } from "lucide-react";

/**
 * StrokeKeypad — the stroke-play entry control (entry_schema = 'user_holes').
 *
 * *A* score-input control, not "the grid's keypad" — a different entry schema
 * swaps it out. Purely presentational + stateless: the pending value (`value`
 * prop) is the single source of truth. A tapped digit fires `onCommit(value)`
 * immediately (no per-score confirm); the parent persists.
 *
 * "10+" behaves like any number key: tap once → selects 10; tap again → 11, 12…
 * (for the rare high score). It highlights (teal) whenever the pending value is
 * ≥ 10 — no extra component state, just `value >= 10`.
 */
interface StrokeKeypadProps {
  participantName: string;
  /** Current committed value for the active cell (the pending/selected value). */
  value: number | null;
  onCommit: (value: number) => void;
  onClear: () => void;
  onConfirm: () => void;
}

const KEY_H = 54;

export function StrokeKeypad({
  participantName,
  value,
  onCommit,
  onClear,
  onConfirm,
}: StrokeKeypadProps) {
  const hasValue = value != null;
  const tensSelected = value != null && value >= 10;

  // 10+ : from empty/single-digit → 10; from ≥10 → increment (capped at 99).
  const tapTens = () => onCommit(tensSelected ? Math.min(99, value + 1) : 10);

  const numKey = (d: number) => {
    const selected = value === d;
    return (
      <button
        key={d}
        type="button"
        onClick={() => onCommit(d)}
        aria-label={`Score ${d}`}
        className="flex items-center justify-center font-semibold transition-transform active:scale-[0.97]"
        style={{
          height: KEY_H,
          borderRadius: 10,
          fontSize: 24,
          background: selected ? "var(--color-bt-accent)" : "var(--color-bt-card)",
          border: selected ? "none" : "1px solid var(--color-bt-border)",
          color: selected ? "#0d1f1a" : "var(--color-bt-text)",
        }}
      >
        {d}
      </button>
    );
  };

  return (
    <div
      style={{
        background: "var(--color-bt-card-float)",
        borderTop: "1px solid var(--color-bt-border)",
        padding: "12px 16px 22px",
      }}
    >
      <div
        className="text-center"
        style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginBottom: 10 }}
      >
        {participantName} — Enter score
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(numKey)}

        {/* Delete — clears the pending value */}
        <button
          type="button"
          onClick={onClear}
          aria-label="Delete"
          className="flex items-center justify-center transition-transform active:scale-[0.97]"
          style={{
            height: KEY_H,
            borderRadius: 10,
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
          }}
        >
          <Delete size={20} strokeWidth={1.9} />
        </button>

        {/* 10+ — selects 10, then increments. Highlights like a number key when value ≥ 10. */}
        <button
          type="button"
          onClick={tapTens}
          aria-label="Scores 10 and up"
          className="flex items-center justify-center font-semibold transition-transform active:scale-[0.97]"
          style={{
            height: KEY_H,
            borderRadius: 10,
            fontSize: 15,
            background: tensSelected ? "var(--color-bt-accent)" : "var(--color-bt-card)",
            border: tensSelected ? "none" : "1px solid var(--color-bt-border)",
            color: tensSelected ? "#0d1f1a" : "var(--color-bt-text-dim)",
          }}
        >
          10+
        </button>

        {/* Confirm */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={!hasValue}
          aria-label="Confirm score"
          className="flex items-center justify-center transition-transform active:scale-[0.97]"
          style={{
            height: KEY_H,
            borderRadius: 10,
            background: hasValue ? "var(--color-bt-accent)" : "var(--color-bt-card-raised)",
            border: hasValue ? "none" : "1px solid var(--color-bt-border)",
            color: hasValue ? "#0d1f1a" : "var(--color-bt-text-dim)",
          }}
        >
          <Check size={22} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
