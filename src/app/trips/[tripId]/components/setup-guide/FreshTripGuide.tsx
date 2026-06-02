"use client";

import { X } from "lucide-react";
import { StepCard } from "./StepCard";
import { SetDatesFlipCard } from "./SetDatesFlipCard";
import {
  LodgingThumbnail,
  CrewThumbnail,
  AgendaThumbnail,
} from "./thumbnails";
import { formatDateRangeCompact } from "@/lib/dates";
import type { TripData } from "../../tabs/types";

// ── FreshTripGuide ───────────────────────────────────────────────────────
//
// The empty-itinerary teaching surface for a fresh trip. Renders an
// "Itinerary" header (eyebrow + title + dismiss ×) and a 4-up responsive
// grid of step cards: dates / lodging / crew / agenda. The dates card
// flips in place to reveal an inline date picker; the other three are
// launchers to their tab. Steps 2–4 are independent — nothing is gated on
// dates being set yet, so the owner can add things in any order.
//
// Once trip.start_date is locked, the eyebrow flips from "New trip" to
// "Get set up", the title flips to "Add what you've got", and the dates
// step renders its done state ("May 26 – Jun 14") — but every step
// remains as an add-launcher so the guide stays useful through the rest
// of setup.

export interface FreshTripGuideProps {
  tripId: string;
  trip: TripData;
  /** Opens the existing DatesSheet (used by the dates flip-card's Poll
   *  branch when ≥2 crew, since the full poll builder lives there). */
  onOpenDatesSheet?: () => void;
  /** Navigate to a tab — drives the Lodging / Crew / Agenda step CTAs and
   *  the "Add the crew first" redirect in the Poll branch. */
  onTabChange?: (tab: string) => void;
  /** Owner dismissed the guide. The ItineraryPanel handles what to render
   *  next (DismissedEmptyState if no dates, real bookends + restore link
   *  if dates set), so the guide just calls this. */
  onDismiss: () => void;
}

export function FreshTripGuide({
  tripId,
  trip,
  onOpenDatesSheet,
  onTabChange,
  onDismiss,
}: FreshTripGuideProps) {
  const datesSet = !!(trip.start_date && trip.end_date);
  const eyebrow = datesSet ? "Get set up" : "New trip";
  const headline = datesSet
    ? "Add what you've got"
    : "Your itinerary builds itself";
  const datesSummary = datesSet
    ? formatDateRangeCompact(trip.start_date, trip.end_date)
    : undefined;

  return (
    <section
      className="rounded-2xl p-5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="fresh-trip-guide"
    >
      {/* Header — eyebrow + title + dismiss */}
      <header className="relative pr-10">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "var(--color-bt-accent)" }}
        >
          {eyebrow}
        </p>
        <h2
          className="mt-1 text-lg font-bold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          {headline}
        </h2>
        <p
          className="mt-1 text-[12px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {datesSet
            ? "Lodging, crew, and agenda items feed straight into the timeline below. Tap any step to keep going."
            : "Tap a step to start. Anything you add — lodging, crew, agenda — weaves into the day-by-day timeline once dates are set."}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss setup guide"
          className="absolute right-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
          data-testid="fresh-trip-guide-dismiss"
        >
          <X size={16} />
        </button>
      </header>

      {/* Step grid — 1 col mobile, 2 col tablet, 4 col desktop */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Step 1 — Set dates (flip card) */}
        <SetDatesFlipCard
          tripId={tripId}
          trip={trip}
          onOpenDatesSheet={onOpenDatesSheet}
          onTabChange={onTabChange}
          done={datesSet}
          doneSummary={datesSummary}
        />

        {/* Step 2 — Add lodging */}
        <StepCard
          number={2}
          domain="lodging"
          title="Add lodging"
          body="The houses, rooms, and check-in details. Each property becomes a card in the timeline."
          thumbnail={<LodgingThumbnail />}
          cta="Add a property"
          onCta={() => onTabChange?.("lodging")}
          testId="guide-step-lodging"
        />

        {/* Step 3 — Invite the crew */}
        <StepCard
          number={3}
          domain="crew"
          title="Invite the crew"
          body="Add everyone joining. Crew members sign up, RSVP, and share their travel."
          thumbnail={<CrewThumbnail />}
          cta="Invite crew"
          onCta={() => onTabChange?.("crew")}
          testId="guide-step-crew"
        />

        {/* Step 4 — Plan the agenda */}
        <StepCard
          number={4}
          domain="agenda"
          title="Plan the agenda"
          body="Activities, tee times, dinners. Confirmed items appear on the timeline."
          thumbnail={<AgendaThumbnail />}
          cta="Plan something"
          onCta={() => onTabChange?.("schedule")}
          testId="guide-step-agenda"
        />
      </div>
    </section>
  );
}
