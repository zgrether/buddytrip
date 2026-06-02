"use client";

import { Calendar } from "lucide-react";
import { DOMAIN_COLORS } from "@/lib/domainColors";

// ── DismissedEmptyState ──────────────────────────────────────────────────
//
// Shown when the owner has dismissed the FreshTripGuide AND no dates are
// set. A single clean dashed empty card with one clear path: Set dates.
// The "Show setup guide" link lets the owner bring the guide back.
//
// When dates ARE set we don't render this — the real itinerary bookends
// from ItineraryView take over, with the "Show setup guide" link sitting
// above them (ItineraryPanel handles that case).

export function DismissedEmptyState({
  onSetDates,
  onRestoreGuide,
}: {
  onSetDates: () => void;
  onRestoreGuide: () => void;
}) {
  const tint = DOMAIN_COLORS.home;
  return (
    <div className="flex flex-col items-stretch gap-2">
      <div
        className="relative flex flex-1 flex-col items-center rounded-xl p-6 text-center"
        style={{
          background: "var(--color-bt-base)",
          border: "1.5px dashed var(--color-bt-border)",
        }}
        data-testid="guide-dismissed-empty"
      >
        <span
          className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: tint.faint,
            color: tint.color,
          }}
          aria-hidden="true"
        >
          <Calendar size={22} />
        </span>
        <p
          className="text-sm font-bold"
          style={{ color: "var(--color-bt-text)" }}
        >
          Your trip, day by day
        </p>
        <p
          className="mt-1 max-w-[300px] text-xs leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Pick or poll a date range and the timeline starts to build itself
          — lodging check-ins, travel arrivals, and confirmed agenda items
          weave in automatically.
        </p>
        <button
          type="button"
          onClick={onSetDates}
          className="mt-4 rounded-lg px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
          style={{
            background: tint.color,
            color: "var(--color-bt-on-accent, #0d1f1a)",
          }}
          data-testid="guide-dismissed-set-dates"
        >
          Set dates
        </button>
      </div>
      <button
        type="button"
        onClick={onRestoreGuide}
        className="self-center text-[11px] transition-opacity hover:opacity-80"
        style={{ color: "var(--color-bt-text-dim)" }}
        data-testid="guide-dismissed-restore"
      >
        Show setup guide
      </button>
    </div>
  );
}
