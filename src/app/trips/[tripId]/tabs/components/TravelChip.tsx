"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { fmtTime12 } from "@/lib/dates";

// ── TravelChip — the shared travel chip ────────────────────────────────────
//
// ONE chip for BOTH arrivals and departures (no duplicate implementations).
// Collapsed: a single row — avatar + first name + time, with a right-justified
// teal "Details" label when there's a description. Tapping ANY part of the chip
// expands it to reveal the full detail (word-wrapped) and flips the label to
// "Close". A chip with NO detail is a plain, inert single-line row (no label).

/** First token of a name ("Zach Grether" → "Zach"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export interface TravelChipPerson {
  displayName: string;
  /** HH:MM (24h) or null for an untimed leg (renders "TBD"). */
  time: string | null;
  avatarIcon?: string | null;
  isGuest?: boolean | null;
  /** The free-text travel detail. Empty/null → no Details toggle, single line. */
  detail?: string | null;
}

export function TravelChip({ person }: { person: TravelChipPerson }) {
  const [expanded, setExpanded] = useState(false);
  const untimed = !person.time;
  const detail = person.detail?.trim() || null;
  const hasDetail = !!detail;

  // Collapsed row: avatar + name + time, with the teal Details/Close label
  // pushed to the right edge (ml-auto) when there's a detail to reveal.
  const row = (
    <div className="flex w-full items-center gap-1.5">
      <Avatar
        name={person.displayName}
        avatarIcon={person.avatarIcon ?? null}
        sizePx={22}
        muted={person.isGuest ?? false}
      />
      {/* Name + time share a baseline so the smaller time doesn't ride higher. */}
      <span className="inline-flex items-baseline gap-1.5">
        <span
          className="text-[12px] font-semibold leading-none"
          style={{ color: "var(--color-bt-text)" }}
        >
          {firstName(person.displayName)}
        </span>
        <span
          className="text-[11px] leading-none"
          style={{
            color: "var(--color-bt-text-dim)",
            fontStyle: untimed ? "italic" : undefined,
          }}
        >
          {untimed ? "TBD" : fmtTime12(person.time as string)}
        </span>
      </span>
      {hasDetail && (
        <span
          className="ml-auto flex-shrink-0 pl-2 text-[11px] font-semibold"
          style={{ color: "var(--color-bt-accent)" }}
        >
          {expanded ? "Close" : "Details"}
        </span>
      )}
    </div>
  );

  // Full-width pill on the raised surface. Dashed border marks an untimed leg.
  const baseClass = "w-full rounded-2xl py-[6px] pl-[3px] pr-3 text-left";
  const chipStyle = {
    background: "var(--color-bt-card-raised)",
    border: `1px ${untimed ? "dashed" : "solid"} var(--color-bt-border)`,
  } as const;

  // No detail → inert single-line row, not a button (nothing to expand).
  if (!hasDetail) {
    return (
      <div className={baseClass} style={chipStyle}>
        {row}
      </div>
    );
  }

  // Whole chip is the toggle. Detail is hidden until expanded, then wraps.
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
          className="mt-1.5 pl-[28px] text-[11px] leading-snug"
          style={{
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
