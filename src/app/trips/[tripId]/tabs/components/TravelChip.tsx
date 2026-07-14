"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { fmtTime12 } from "@/lib/dates";

// ── TravelChip — the shared two-line travel chip ───────────────────────────
//
// ONE chip for BOTH arrivals and departures (no duplicate implementations).
// Line 1 (primary): avatar + first name + time (or "TBD" when untimed).
// Line 2 (secondary / text-dim): the free-text travel `detail`, truncated to
// one line with an ellipsis. Tapping the chip expands it to reveal the full
// detail; tapping again collapses. Expansion is per-chip (local state).
//
// A chip with NO detail stays single-line and is inert (not a button) — we
// never render an empty second line.

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
  /** The free-text travel detail — the second line. Empty/null → single-line. */
  detail?: string | null;
}

export function TravelChip({ person }: { person: TravelChipPerson }) {
  const [expanded, setExpanded] = useState(false);
  const untimed = !person.time;
  const detail = person.detail?.trim() || null;
  const expandable = !!detail;

  const inner = (
    <>
      <span className="inline-flex items-center gap-1.5">
        <Avatar
          name={person.displayName}
          avatarIcon={person.avatarIcon ?? null}
          sizePx={22}
          muted={person.isGuest ?? false}
        />
        {/* Name + time share a baseline so the smaller time doesn't ride higher
            than the name; the outer row still center-aligns the avatar. */}
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
          {expandable && (
            <ChevronDown
              size={11}
              className="transition-transform"
              style={{
                color: "var(--color-bt-text-dim)",
                transform: expanded ? "rotate(180deg)" : undefined,
              }}
              aria-hidden
            />
          )}
        </span>
      </span>
      {detail && (
        // Second line — details, in the secondary text treatment. Aligned under
        // the name (past the 22px avatar + 6px gap). Collapsed = one-line
        // ellipsis; expanded = wraps to full text.
        <span
          className={`mt-1 block pl-[28px] text-[11px] leading-snug ${
            expanded ? "whitespace-normal break-words" : "truncate"
          }`}
          style={{ color: "var(--color-bt-text-dim)", maxWidth: "100%" }}
        >
          {detail}
        </span>
      )}
    </>
  );

  // Compact pill on the raised surface. Dashed border marks an untimed leg
  // (matches the prior arrivals treatment). Capped width so a long detail
  // truncates rather than ballooning the row; expanded, it wraps within the cap.
  const baseClass = "inline-flex flex-col items-start rounded-2xl py-[5px] pl-[3px] pr-2.5 text-left align-top";
  const chipStyle = {
    background: "var(--color-bt-card-raised)",
    border: `1px ${untimed ? "dashed" : "solid"} var(--color-bt-border)`,
    maxWidth: "min(100%, 260px)",
  } as const;

  if (!expandable) {
    return (
      <span className={baseClass} style={chipStyle}>
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={baseClass}
      style={chipStyle}
    >
      {inner}
    </button>
  );
}
