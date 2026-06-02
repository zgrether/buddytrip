"use client";

// ── Step thumbnails ──────────────────────────────────────────────────────
//
// Tiny stylized previews of each tab's UI — not literal screenshots, just
// enough cue per step that the grid scans at a glance. Each thumbnail
// renders into a domain-tinted backing in StepCard; colors come from
// currentColor + small alpha plates so individual rebrands sweep through.

const TILE_BG = "rgba(255,255,255,0.04)";
const TILE_BORDER = "rgba(255,255,255,0.08)";

// ── Calendar (Step 1: Set dates) ─────────────────────────────────────────
//
// A 3x5 month grid with a highlighted range across the middle row — reads
// as "calendar with dates selected" without needing dates to be legible.

export function CalendarThumbnail() {
  return (
    <div
      className="flex flex-col gap-[3px] rounded-md p-2"
      style={{
        background: TILE_BG,
        border: `1px solid ${TILE_BORDER}`,
        width: 64,
      }}
      aria-hidden="true"
    >
      {/* Header strip */}
      <div className="mb-[2px] flex items-center justify-between">
        <span
          className="block h-[3px] w-3 rounded-sm"
          style={{ background: "currentColor", opacity: 0.7 }}
        />
        <span className="flex gap-[2px]">
          <span
            className="block h-[3px] w-[3px] rounded-full"
            style={{ background: "currentColor", opacity: 0.4 }}
          />
          <span
            className="block h-[3px] w-[3px] rounded-full"
            style={{ background: "currentColor", opacity: 0.4 }}
          />
        </span>
      </div>
      {/* Weekday row */}
      <div className="grid grid-cols-7 gap-[2px]">
        {Array.from({ length: 7 }).map((_, i) => (
          <span
            key={`h-${i}`}
            className="block h-[2px]"
            style={{ background: "currentColor", opacity: 0.35 }}
          />
        ))}
      </div>
      {/* Day grid — middle row highlighted as a 5-day range */}
      {Array.from({ length: 4 }).map((_, row) => (
        <div key={`r-${row}`} className="grid grid-cols-7 gap-[2px]">
          {Array.from({ length: 7 }).map((_, col) => {
            const idx = row * 7 + col;
            const inRange = idx >= 8 && idx <= 12;
            const isCap = idx === 8 || idx === 12;
            return (
              <span
                key={`d-${idx}`}
                className="block h-[5px] rounded-[1px]"
                style={{
                  background: isCap
                    ? "currentColor"
                    : inRange
                      ? "currentColor"
                      : "rgba(255,255,255,0.10)",
                  opacity: isCap ? 1 : inRange ? 0.45 : 1,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Lodging (Step 2) ─────────────────────────────────────────────────────
//
// Tiny lodging card: image block on top, two text lines below, a pill on
// the right of the title line.

export function LodgingThumbnail() {
  return (
    <div
      className="flex flex-col gap-[3px] rounded-md p-1.5"
      style={{
        background: TILE_BG,
        border: `1px solid ${TILE_BORDER}`,
        width: 64,
      }}
      aria-hidden="true"
    >
      {/* Image block */}
      <div
        className="h-[18px] w-full rounded-[2px]"
        style={{ background: "currentColor", opacity: 0.30 }}
      />
      {/* Title row with pill */}
      <div className="flex items-center justify-between gap-1">
        <span
          className="block h-[3px] flex-1 rounded-sm"
          style={{ background: "currentColor", opacity: 0.75 }}
        />
        <span
          className="block h-[5px] w-[10px] rounded-full"
          style={{ background: "currentColor", opacity: 0.55 }}
        />
      </div>
      {/* Subtitle line */}
      <span
        className="block h-[2px] w-9 rounded-sm"
        style={{ background: "currentColor", opacity: 0.4 }}
      />
      {/* Detail line */}
      <span
        className="block h-[2px] w-7 rounded-sm"
        style={{ background: "currentColor", opacity: 0.3 }}
      />
    </div>
  );
}

// ── Crew (Step 3) ────────────────────────────────────────────────────────
//
// Three roster rows — colored avatar dot + name line + status pill.

export function CrewThumbnail() {
  // Distinct dot colors so the roster reads as "different people" even
  // without the rest of the domain-color system lit up yet.
  const dots = [
    "rgba(96,165,250,0.85)", // blue
    "rgba(251,191,36,0.85)", // amber
    "rgba(251,113,133,0.85)", // rose
  ];
  return (
    <div
      className="flex flex-col gap-[3px] rounded-md p-1.5"
      style={{
        background: TILE_BG,
        border: `1px solid ${TILE_BORDER}`,
        width: 64,
      }}
      aria-hidden="true"
    >
      {dots.map((dot, i) => (
        <div key={i} className="flex items-center gap-1">
          <span
            className="block h-[6px] w-[6px] flex-shrink-0 rounded-full"
            style={{ background: dot }}
          />
          <span
            className="block h-[3px] flex-1 rounded-sm"
            style={{
              background: "currentColor",
              opacity: 0.55 - i * 0.1,
            }}
          />
          <span
            className="block h-[3px] w-[8px] rounded-full"
            style={{ background: "currentColor", opacity: 0.35 }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Agenda (Step 4) ──────────────────────────────────────────────────────
//
// A day cluster: small day badge on top, then three event rows each with a
// colored left marker and a title bar.

export function AgendaThumbnail() {
  const markers = [
    "currentColor", // primary
    "rgba(251,191,36,0.85)", // amber accent
    "currentColor",
  ];
  return (
    <div
      className="flex flex-col gap-[3px] rounded-md p-1.5"
      style={{
        background: TILE_BG,
        border: `1px solid ${TILE_BORDER}`,
        width: 64,
      }}
      aria-hidden="true"
    >
      {/* Day badge */}
      <span
        className="block h-[4px] w-[20px] rounded-sm"
        style={{ background: "currentColor", opacity: 0.45 }}
      />
      {/* Event chips */}
      {markers.map((marker, i) => (
        <div
          key={i}
          className="flex items-center gap-1 rounded-[2px] py-[1.5px] pl-1"
          style={{
            background: "rgba(255,255,255,0.06)",
            borderLeft: `2px solid ${marker}`,
          }}
        >
          <span
            className="block h-[3px] flex-1 rounded-sm"
            style={{ background: "currentColor", opacity: 0.6 - i * 0.05 }}
          />
        </div>
      ))}
    </div>
  );
}
