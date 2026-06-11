"use client";

import { golfResult, GOLF_STYLE } from "./golfScore";

/**
 * GolfChip — a committed score shown with the Traditional par-relative shape +
 * color (Slice C §1). Circle (under par) / rounded square (over par) / bare
 * number (par). Single ring = a 1.5px border; DOUBLE ring = a concentric INNER
 * border inset within `size` (never a box-shadow — a shadow paints outside the
 * chip and collides with neighbors in the tight grid cells).
 *
 * `celebrate` plays a one-shot halo+pop for eagle/birdie (gated on
 * prefers-reduced-motion in globals.css). The number is ringed, never on a
 * solid-filled cell, so it can't read as a button.
 */
interface GolfChipProps {
  value: number;
  par: number;
  size: number;
  fontSize?: number;
  celebrate?: boolean;
}

export function GolfChip({ value, par, size, fontSize, celebrate }: GolfChipProps) {
  const result = golfResult(value, par)!; // caller passes a real value
  const s = GOLF_STYLE[result];
  const radius = s.shape === "circle" ? "50%" : s.shape === "square" ? 5 : 0;
  const ring = s.ring !== "none" ? `1.5px solid ${s.fg}` : "none";
  const showHalo = celebrate && (result === "eagle" || result === "birdie");

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: s.bg,
        border: ring,
        color: s.fg,
        fontSize: fontSize ?? Math.round(size * 0.5),
        fontWeight: 700,
        boxSizing: "border-box",
        animation: showHalo ? "golfPop 0.5s ease-out" : undefined,
      }}
    >
      {/* Double ring — concentric inner border, contained within `size`. */}
      {s.ring === "double" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 3,
            borderRadius: s.shape === "circle" ? "50%" : 3,
            border: `1.5px solid ${s.fg}`,
          }}
        />
      )}
      {/* Eagle/birdie halo — one-shot, pulses outward (reduced-motion safe). */}
      {showHalo && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: s.shape === "circle" ? "50%" : 6,
            border: `2px solid ${s.fg}`,
            animation: "golfHalo 0.7s ease-out",
          }}
        />
      )}
      {value}
    </span>
  );
}
