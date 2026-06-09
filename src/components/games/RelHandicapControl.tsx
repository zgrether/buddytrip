"use client";

import { strokeHoles } from "@/lib/matchPlay";
import type { Participant } from "./types";

/**
 * RelHandicapControl — the relative-handicap control for 1v1 (Slice B §6, as
 * amended by Spec Addendum B-1). A direction TOGGLE + a STEPPER — no draggable
 * slider (a ±18 span is undraggable one-thumbed in the sun; the number matters
 * most in the big-mismatch case, exactly where a bare slider fails).
 *
 * Same data model: one signed value, strokes to exactly ONE side, never split.
 *   value < 0 → left (a) gets |value|;  value > 0 → right (b) gets value;  0 = even.
 * The parent persists it as the two per-user `game_participants.handicap_strokes`
 * counts (recipient = n, other = 0) — NOT `games.modifiers.buddy_rules` (Slice F).
 */

// Single source of truth for the magnitude cap. To raise this above 18,
// `strokeHoles` must first allocate a 2nd stroke per round on the hardest holes
// (it caps at 18 today, and returns a Set so a hole can't be struck twice) —
// otherwise strokes 19+ silently produce no extra pips. See Spec Addendum B-1.
const MAX = 18;

interface RelHandicapControlProps {
  a: Participant;
  b: Participant;
  value: number; // signed, ∈ [−MAX, MAX]
  onChange: (value: number) => void;
}

export function RelHandicapControl({ a, b, value, onChange }: RelHandicapControlProps) {
  const clamped = Math.max(-MAX, Math.min(MAX, Math.round(value)));
  const side: "a" | "b" | "even" = clamped < 0 ? "a" : clamped > 0 ? "b" : "even";
  const n = Math.abs(clamped);
  const holes = [...strokeHoles(n)].sort((x, y) => x - y);

  // Selecting a player keeps the current magnitude (min 1) and points it that way.
  // Switching sides preserves |value| (sign flip).
  const pickSide = (target: "a" | "b") => {
    const mag = n === 0 ? 1 : n;
    onChange(target === "a" ? -mag : mag);
  };
  // Step magnitude; never crosses into Even (Even is toggle-only). Inert when even.
  const step = (delta: number) => {
    if (side === "even") return;
    const mag = Math.max(1, Math.min(MAX, n + delta));
    onChange(side === "a" ? -mag : mag);
  };

  const even = side === "even";

  return (
    <div style={{ padding: "2px 2px 0" }}>
      {/* Row 1 · Direction (segmented control) */}
      <div
        className="flex"
        style={{ gap: 4, padding: 4, borderRadius: 12, background: "var(--color-bt-card-raised)" }}
      >
        <Segment selected={side === "a"} onClick={() => pickSide("a")}>
          <span style={dotStyle(a.color)} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
        </Segment>
        <Segment selected={even} onClick={() => onChange(0)}>
          Even
        </Segment>
        <Segment selected={side === "b"} onClick={() => pickSide("b")}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
          <span style={dotStyle(b.color)} />
        </Segment>
      </div>

      {/* Row 2 · Magnitude (stepper) */}
      <div
        className="flex items-center justify-center"
        style={{ gap: 18, marginTop: 12, opacity: even ? 0.35 : 1, pointerEvents: even ? "none" : "auto" }}
      >
        <StepButton symbol="−" disabled={even || n <= 1} onClick={() => step(-1)} />
        <div className="text-center" style={{ minWidth: 44 }}>
          <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: "var(--color-bt-text)" }}>
            {even ? "—" : n}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--color-bt-text-dim)", marginTop: 4 }}>
            {n === 1 ? "STROKE" : "STROKES"}
          </div>
        </div>
        <StepButton symbol="+" disabled={even || n >= MAX} onClick={() => step(1)} />
      </div>

      {/* Resolved line */}
      <div className="text-center" style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
        {even ? (
          "Even match — no strokes given"
        ) : (
          <span>
            on hole{n === 1 ? "" : "s"} {holes.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

function Segment({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center justify-center gap-1.5"
      style={{
        height: 40,
        borderRadius: 9,
        padding: "0 6px",
        background: selected ? "var(--color-bt-accent)" : "transparent",
        color: selected ? "#0d1f1a" : "var(--color-bt-text-dim)",
        fontSize: 14,
        fontWeight: selected ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

function StepButton({ symbol, disabled, onClick }: { symbol: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={symbol === "+" ? "Add a stroke" : "Remove a stroke"}
      className="flex items-center justify-center"
      style={{
        width: 52,
        height: 48,
        borderRadius: 12,
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        color: "var(--color-bt-text)",
        fontSize: 24,
        fontWeight: 600,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {symbol}
    </button>
  );
}

function dotStyle(color: string): React.CSSProperties {
  return { width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 };
}
