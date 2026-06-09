"use client";

import { strokeHoles } from "@/lib/matchPlay";
import type { Participant } from "./types";

/**
 * RelHandicapSlider — the relative-handicap control for 1v1 (Slice B, §6). One
 * match = ONE signed value; strokes slide to ONE side (you never split). The
 * recipient is whichever side the thumb is on; the other always gets 0.
 *
 *   value < 0 → left player (a) gets |value|;  value > 0 → right (b) gets value.
 *
 * The signed value is a UI convenience; the parent persists it as the two
 * per-user counts (`game_participants.handicap_strokes`).
 *
 * Teal (`--color-bt-accent`) is correct here — a slider is an active control.
 */
interface RelHandicapSliderProps {
  a: Participant;
  b: Participant;
  value: number; // signed, ∈ [−max, max]
  max?: number;
  onChange: (value: number) => void;
}

export function RelHandicapSlider({ a, b, value, max = 18, onChange }: RelHandicapSliderProps) {
  const clamped = Math.max(-max, Math.min(max, Math.round(value)));
  const recipient = clamped < 0 ? a : clamped > 0 ? b : null;
  const n = Math.abs(clamped);
  const holes = [...strokeHoles(n)].sort((x, y) => x - y);
  const thumbPct = 50 + (clamped / max) * 40; // ±max → 10%…90%
  const offCenter = clamped !== 0;
  // Fill from center to thumb.
  const fillLeft = Math.min(50, thumbPct);
  const fillWidth = Math.abs(thumbPct - 50);

  return (
    <div style={{ padding: "4px 2px" }}>
      {/* Top label row */}
      <div
        className="flex items-center justify-between"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-bt-text-dim)",
          marginBottom: 10,
        }}
      >
        <span>◀ {a.name}</span>
        <span>even</span>
        <span>{b.name} ▶</span>
      </div>

      {/* Track */}
      <div style={{ position: "relative", height: 22 }}>
        {/* base bar */}
        <div
          style={{
            position: "absolute",
            top: 9,
            left: 0,
            right: 0,
            height: 4,
            borderRadius: 2,
            background: "var(--color-bt-card-raised)",
          }}
        />
        {/* center detent */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: "50%",
            width: 2,
            height: 10,
            transform: "translateX(-50%)",
            background: "var(--color-bt-border)",
          }}
        />
        {/* fill from center */}
        {offCenter && (
          <div
            style={{
              position: "absolute",
              top: 9,
              left: `${fillLeft}%`,
              width: `${fillWidth}%`,
              height: 4,
              borderRadius: 2,
              background: "var(--color-bt-accent)",
            }}
          />
        )}
        {/* thumb */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${thumbPct}%`,
            width: 22,
            height: 22,
            borderRadius: "50%",
            transform: "translateX(-50%)",
            background: "var(--color-bt-text)",
            border: `2px solid ${offCenter ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
            pointerEvents: "none",
          }}
        />
        {/* native range overlay for drag + keyboard a11y (snaps to integer stops) */}
        <input
          type="range"
          min={-max}
          max={max}
          step={1}
          value={clamped}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`Handicap strokes: ${recipient ? `${recipient.name} gets ${n}` : "even"}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            margin: 0,
            opacity: 0,
            cursor: "pointer",
          }}
        />
      </div>

      {/* Resolved state */}
      <div
        className="text-center"
        style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 10 }}
      >
        {recipient ? (
          <span>
            <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>{recipient.name}</span> gets{" "}
            <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>{n}</span> · {holes.join(", ")}
          </span>
        ) : (
          "Even match — no strokes"
        )}
      </div>
    </div>
  );
}
