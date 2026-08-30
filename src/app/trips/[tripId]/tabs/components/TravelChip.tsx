"use client";

import { useState } from "react";
import { Car, Navigation, Plane, PlaneTakeoff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fmtTime12 } from "@/lib/dates";
import type { TravelChipModel, TravelMode } from "./travelBands";

// ── TravelChip — the shared travel chip ────────────────────────────────────
//
// ONE chip for BOTH arrivals and departures (no duplicate implementations).
// A chip stands for one time + one mode + one detail, and therefore for one OR
// MORE people — "9:30 AM · Brad, Rob, Jason" is a single chip.
//
// Anatomy, left to right: a fixed 58px time column (so every name in every
// band shares one left edge), the wrapping name span, and a 13px mode icon.
// There is no avatar and no per-chip "Details" label — the card header's
// legend explains the icons and carries the tap affordance once. Tapping still
// expands the chip to its detail text; a chip with no detail is inert (a div,
// not a button). An untimed leg keeps its dashed border and italic "TBD".

export const MODE_COLOR: Record<TravelMode, string> = {
  flying: "var(--color-bt-accent)",
  driving: "var(--color-bt-ready)",
  other: "var(--color-bt-text-dim)",
};

export const MODE_LABEL: Record<TravelMode, string> = {
  flying: "Flying",
  driving: "Driving",
  other: "Other",
};

/** Departures swap the flying glyph for a taking-off plane. A lookup table
 *  rather than a function, so the component identity is stable across renders
 *  (`react-hooks/static-components` rejects a component built during render). */
export const MODE_ICON: Record<"arrival" | "departure", Record<TravelMode, LucideIcon>> = {
  arrival: { flying: Plane, driving: Car, other: Navigation },
  departure: { flying: PlaneTakeoff, driving: Car, other: Navigation },
};

/** The 58px time column — a constant, so the chip and its expanded detail
 *  (which insets to line up under the name) can't drift apart. */
const TIME_COL_PX = 58;
/** Time column + the 10px flex gap = where the name starts. */
const NAME_INSET_PX = TIME_COL_PX + 10;

export function TravelChip({
  chip,
  direction,
}: {
  chip: TravelChipModel;
  direction: "arrival" | "departure";
}) {
  const [expanded, setExpanded] = useState(false);
  const untimed = !chip.time;
  const detail = chip.detail?.trim() || null;
  const hasDetail = !!detail;
  const Icon = MODE_ICON[direction][chip.mode];

  // Time and icon are fixed columns; only the name wraps, so a four-name chip
  // in a narrow column grows to two lines with the left edge and the icon held.
  const row = (
    <div className="flex w-full items-start gap-2.5">
      <span
        className="mt-[1px] flex-none text-[11px] leading-[1.35]"
        style={{
          width: `${TIME_COL_PX}px`,
          color: "var(--color-bt-text-dim)",
          fontStyle: untimed ? "italic" : undefined,
        }}
      >
        {untimed ? "TBD" : fmtTime12(chip.time as string)}
      </span>
      <span
        className="min-w-0 flex-1 text-[12.5px] font-semibold leading-[1.35]"
        style={{ color: "var(--color-bt-text)", overflowWrap: "anywhere" }}
      >
        {chip.names.join(", ")}
      </span>
      <Icon
        size={13}
        strokeWidth={1.75}
        className="mt-[2px] flex-none"
        style={{ color: MODE_COLOR[chip.mode] }}
        aria-label={MODE_LABEL[chip.mode]}
      />
    </div>
  );

  // Full-width pill on the raised surface. Dashed border marks an untimed leg.
  const baseClass = "flex w-full min-h-10 flex-col justify-center rounded-2xl px-3 py-[9px] text-left sm:py-2";
  const chipStyle = {
    background: "var(--color-bt-card-raised)",
    border: `1px ${untimed ? "dashed" : "solid"} var(--color-bt-border)`,
  } as const;

  // No detail → inert row, not a button (nothing to expand).
  if (!hasDetail) {
    return (
      <div className={baseClass} style={chipStyle}>
        {row}
      </div>
    );
  }

  // Whole chip is the toggle. Detail is hidden until expanded, then wraps
  // under the name rather than under the time column.
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={baseClass}
      style={chipStyle}
    >
      {row}
      {expanded && (
        <p
          className="mt-1.5 text-[11px] leading-snug"
          style={{
            paddingLeft: `${NAME_INSET_PX}px`,
            color: "var(--color-bt-text-dim)",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {detail}
        </p>
      )}
    </button>
  );
}
