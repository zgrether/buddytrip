"use client";

import { useTheme } from "next-themes";

// ── Step thumbnails ──────────────────────────────────────────────────────
//
// Each thumbnail renders flush into StepCard's dark preview area — no
// inner border, no inner panel. Just the stylized mini-UI on the parent
// surface. Colors are explicit so each step reads as its own UI rather
// than a single tinted plate (lodging blue gradient, crew rose/teal/blue
// dots, agenda amber outlines, etc.).

/**
 * The four neutral tones every thumbnail draws its placeholder bars with.
 *
 * THEY WERE WHITE LITERALS, so on a light card all 42 of them composited to a
 * delta of ~2/255 against their own ground and the mockups rendered as their
 * coloured accents floating on nothing — the teal cells with no calendar, the
 * roster dots with no names, the amber markers with no rows. Every COLOURED
 * element was always fine; only the neutrals were missing a light value.
 *
 * One hook rather than four copies of the branch: these are one family, and a
 * per-thumbnail copy is how the four drift apart. Same shape as the sibling
 * silhouette consumers (TripCard.tsx:174 and RailTripRow.tsx:209), so the dark
 * arm is the literal each constant already had and dark is byte-identical.
 *
 * THE LIGHT ALPHAS ARE NOT THE DARK ONES MIRRORED, AND NOT THE NEAREST
 * TOKEN. Both were tried and both came out too faint, for the same reason:
 * matching a LINEAR RGB delta between the tone and its ground is not matching
 * what the eye does. A white bar on near-black and a black bar on near-white
 * at the same delta read very differently — the light one weaker every time.
 *
 * These are matched on CONTRAST RATIO against the preview surface, which is
 * the metric that tracks perception:
 *
 *              dark      first try (delta-matched)    shipped (ratio-matched)
 *   DIM        1.28      0.08 -> 1.20  (0.94x)        0.11  -> 1.28
 *   DIM_BRIGHT 1.68      0.15 -> 1.41  (0.84x)        0.22  -> 1.68
 *   TEXT_DIM   3.18      0.35 -> 2.42  (0.76x)        0.44  -> 3.18
 *   TEXT_DIMR  1.95      0.22 -> 1.69  (0.86x)        0.275 -> 1.95
 *
 * The delta-matched pass shipped nothing visibly wrong — the bars were there —
 * but every one was 6-24% lighter than its dark counterpart, and the eye
 * called it before the numbers did. Keep the ratio, not the alpha.
 */
function useThumbnailTones() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return {
    DIM: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.11)",
    DIM_BRIGHTER: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.22)",
    TEXT_DIM: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.44)",
    TEXT_DIMMER: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.275)",
  };
}

// ── Calendar (Step 1: Set dates) ─────────────────────────────────────────
//
// Sparse grid (5×7) on the dark preview surface. Two cells filled in
// accent teal hint at the selected range without literally drawing a
// month — the picker itself does that.

export function CalendarThumbnail({ accent }: { accent?: string } = {}) {
  const { DIM, TEXT_DIM } = useThumbnailTones();
  const ACCENT = accent ?? "var(--color-bt-accent)";
  // Cells filled solid teal — the "selected range" hint.
  const filled = new Set([10, 26]);
  // Cells faintly tinted to soften the grid before the picker opens.
  const tinted = new Set([11, 27]);
  return (
    <div
      className="grid h-full w-full grid-cols-7 gap-[6px] p-3"
      aria-hidden="true"
    >
      {/* Tiny header strip — top-left bar */}
      <span className="col-span-2 h-[3px] rounded-sm" style={{ background: TEXT_DIM }} />
      <span className="col-span-5" />
      {Array.from({ length: 35 }).map((_, i) => {
        const fill = filled.has(i)
          ? ACCENT
          : tinted.has(i)
            ? "color-mix(in srgb, var(--color-bt-accent) 28%, transparent)"
            : DIM;
        return (
          <span
            key={i}
            className="aspect-square rounded-[3px]"
            style={{ background: fill }}
          />
        );
      })}
    </div>
  );
}

// ── Lodging (Step 2) ─────────────────────────────────────────────────────
//
// Property card: blue gradient image block on top + a long title bar +
// a shorter detail bar with a small button on the right.

export function LodgingThumbnail() {
  const { DIM, DIM_BRIGHTER } = useThumbnailTones();
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3" aria-hidden="true">
      <div
        className="h-[40%] w-full rounded-md"
        style={{
          background:
            "linear-gradient(135deg, rgba(96,165,250,0.95) 0%, rgba(59,130,246,0.85) 70%, rgba(37,99,235,0.75) 100%)",
        }}
      />
      <span
        className="h-[5px] w-full rounded-sm"
        style={{ background: DIM_BRIGHTER }}
      />
      <div className="flex items-center gap-2">
        <span className="h-[5px] flex-1 rounded-sm" style={{ background: DIM }} />
        <span
          className="h-[12px] w-[24px] rounded-sm"
          style={{ background: DIM_BRIGHTER }}
        />
      </div>
    </div>
  );
}

// ── Crew (Step 3) ────────────────────────────────────────────────────────
//
// Three roster rows: colored dot + name line. Distinct dot colors so the
// roster reads as different people even with the domain palette in its
// placeholder-teal state.

export function CrewThumbnail() {
  const { DIM_BRIGHTER } = useThumbnailTones();
  const rows: [string, number][] = [
    ["rgba(244,114,182,0.95)", 70], // rose
    ["rgba(45,212,191,0.95)", 60], // teal
    ["rgba(96,165,250,0.95)", 55], // blue
  ];
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-3 p-4"
      aria-hidden="true"
    >
      {rows.map(([color, widthPct], i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className="h-3 w-3 flex-shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span
            className="h-[5px] rounded-sm"
            style={{ background: DIM_BRIGHTER, width: `${widthPct}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Agenda (Step 4) ──────────────────────────────────────────────────────
//
// Two event chips: tiny amber/orange outlined squares (event markers) +
// title line + a small trailing time pill.

export function AgendaThumbnail() {
  const { DIM_BRIGHTER, TEXT_DIMMER } = useThumbnailTones();
  const items = [
    { ring: "rgba(251,191,36,0.85)", line: 60 },
    { ring: "rgba(251,113,36,0.85)", line: 70 },
  ];
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-3 p-4"
      aria-hidden="true"
    >
      {items.map(({ ring, line }, i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className="h-3 w-3 flex-shrink-0 rounded-[3px]"
            style={{ border: `1.5px solid ${ring}` }}
          />
          <span
            className="h-[5px] rounded-sm"
            style={{ background: DIM_BRIGHTER, width: `${line}%` }}
          />
          <span
            className="h-[5px] w-[28px] flex-shrink-0 rounded-sm"
            style={{ background: TEXT_DIMMER }}
          />
        </div>
      ))}
    </div>
  );
}
