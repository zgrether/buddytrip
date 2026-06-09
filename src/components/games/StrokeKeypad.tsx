"use client";

import { useState } from "react";
import { Delete, Check } from "lucide-react";

/**
 * StrokeKeypad — the stroke-play entry control (entry_schema = 'user_holes').
 *
 * This is *a* score-input control, not "the grid's keypad" — a different entry
 * schema swaps it out. It's purely presentational: a tapped digit fires
 * `onCommit(value)` immediately (no per-score confirm); the parent persists.
 *
 * "10+" path (engine decision): tapping 10+ arms a two-digit state, then the
 * next digit completes it (10+ then 2 → 12). ⌫ cancels the armed state (or, if
 * idle, clears the value); ✓ advances to the next player.
 */
interface StrokeKeypadProps {
  participantName: string;
  /** Current committed value for the active cell (pre-selected highlight). */
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
  // When armed, the next digit becomes 10 + digit (10–19).
  const [tensArmed, setTensArmed] = useState(false);

  function tapDigit(d: number) {
    if (tensArmed) {
      onCommit(10 + d);
      setTensArmed(false);
    } else {
      onCommit(d);
    }
  }

  function tapDelete() {
    if (tensArmed) {
      setTensArmed(false);
      return;
    }
    onClear();
  }

  const numKey = (d: number) => {
    const selected = !tensArmed && value === d;
    return (
      <button
        key={d}
        type="button"
        onClick={() => tapDigit(d)}
        aria-label={`Score ${d}`}
        className="flex items-center justify-center font-semibold transition-transform active:scale-[0.97]"
        style={{
          height: KEY_H,
          borderRadius: 10,
          fontSize: 22,
          background: selected ? "var(--color-bt-accent)" : "var(--color-bt-card)",
          border: selected ? "none" : "1px solid var(--color-bt-border)",
          color: selected ? "#0d1f1a" : "var(--color-bt-text)",
        }}
      >
        {d}
      </button>
    );
  };

  const hasValue = value != null;

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
        style={{ fontSize: 11, color: "var(--color-bt-text-dim)", marginBottom: 10 }}
      >
        {participantName} — Enter score
        {tensArmed ? " (10 + ?)" : ""}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(numKey)}

        {/* Delete */}
        <button
          type="button"
          onClick={tapDelete}
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

        {/* 10+ */}
        <button
          type="button"
          onClick={() => setTensArmed((v) => !v)}
          aria-label="Scores 10 and up"
          className="flex items-center justify-center font-semibold transition-transform active:scale-[0.97]"
          style={{
            height: KEY_H,
            borderRadius: 10,
            fontSize: 13,
            background: tensArmed ? "var(--color-bt-accent)" : "var(--color-bt-card)",
            border: tensArmed ? "none" : "1px solid var(--color-bt-border)",
            color: tensArmed ? "#0d1f1a" : "var(--color-bt-text-dim)",
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
