"use client";

// ── Step thumbnails ──────────────────────────────────────────────────────
//
// Each thumbnail renders flush into StepCard's dark preview area — no
// inner border, no inner panel. Just the stylized mini-UI on the parent
// surface. Colors are explicit so each step reads as its own UI rather
// than a single tinted plate (lodging blue gradient, crew rose/teal/blue
// dots, agenda amber outlines, etc.).

const DIM = "rgba(255,255,255,0.10)";
const DIM_BRIGHTER = "rgba(255,255,255,0.18)";
const TEXT_DIM = "rgba(255,255,255,0.35)";
const TEXT_DIMMER = "rgba(255,255,255,0.22)";

// ── Calendar (Step 1: Set dates) ─────────────────────────────────────────
//
// Sparse grid (5×7) on the dark preview surface. Two cells filled in
// accent teal hint at the selected range without literally drawing a
// month — the picker itself does that.

export function CalendarThumbnail({ accent }: { accent?: string } = {}) {
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
// Property card — exaggerated to fill the preview area:
//   • Big blue-gradient image block (~55% of the height) sits on top
//   • A thick title bar
//   • A shorter detail bar with a chunky trailing pill (price/CTA)

export function LodgingThumbnail() {
  return (
    <div className="flex h-full w-full flex-col gap-4 p-5" aria-hidden="true">
      <div
        className="w-full flex-1 rounded-lg"
        style={{
          background:
            "linear-gradient(135deg, rgba(96,165,250,0.95) 0%, rgba(59,130,246,0.90) 65%, rgba(37,99,235,0.85) 100%)",
        }}
      />
      <span
        className="h-3 w-full rounded-md"
        style={{ background: DIM_BRIGHTER }}
      />
      <div className="flex items-center gap-3">
        <span
          className="h-3 flex-1 rounded-md"
          style={{ background: DIM }}
        />
        <span
          className="h-7 w-14 flex-shrink-0 rounded-md"
          style={{ background: DIM_BRIGHTER }}
        />
      </div>
    </div>
  );
}

// ── Crew (Step 3) ────────────────────────────────────────────────────────
//
// Three roster rows — bigger avatar circles + thicker name bars so the
// roster reads from across the room. Distinct dot colors keep "different
// people" legible even while the domain palette is in placeholder-teal.

export function CrewThumbnail() {
  const rows: [string, number][] = [
    ["rgba(244,114,182,0.95)", 80], // rose
    ["rgba(45,212,191,0.95)", 65], // teal
    ["rgba(96,165,250,0.95)", 55], // blue
  ];
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-5 p-5"
      aria-hidden="true"
    >
      {rows.map(([color, widthPct], i) => (
        <div key={i} className="flex items-center gap-4">
          <span
            className="h-9 w-9 flex-shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span
            className="h-3 rounded-md"
            style={{ background: DIM_BRIGHTER, width: `${widthPct}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Agenda (Step 4) ──────────────────────────────────────────────────────
//
// Two event chips — exaggerated: bigger amber/orange outlined event
// markers, thicker title bar, chunkier trailing time pill.

export function AgendaThumbnail() {
  const items = [
    { ring: "rgba(251,191,36,0.95)", line: 65 },
    { ring: "rgba(251,113,36,0.95)", line: 75 },
  ];
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-5 p-5"
      aria-hidden="true"
    >
      {items.map(({ ring, line }, i) => (
        <div key={i} className="flex items-center gap-4">
          <span
            className="h-9 w-9 flex-shrink-0 rounded-md"
            style={{ border: `2.5px solid ${ring}` }}
          />
          <span
            className="h-3 rounded-md"
            style={{ background: DIM_BRIGHTER, width: `${line}%` }}
          />
          <span
            className="h-3 w-12 flex-shrink-0 rounded-md"
            style={{ background: TEXT_DIMMER }}
          />
        </div>
      ))}
    </div>
  );
}
