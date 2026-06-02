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
// Property card: blue gradient image block on top + a long title bar +
// a shorter detail bar with a small button on the right.

export function LodgingThumbnail() {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-3" aria-hidden="true">
      <div
        className="h-[40%] w-full rounded-md"
        style={{
          background:
            "linear-gradient(135deg, rgba(96,165,250,0.95) 0%, rgba(59,130,246,0.85) 70%, rgba(37,99,235,0.75) 100%)",
        }}
      />
      <span className="h-[5px] w-full rounded-sm" style={{ background: DIM_BRIGHTER }} />
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
