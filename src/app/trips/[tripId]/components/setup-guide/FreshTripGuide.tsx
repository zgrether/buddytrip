"use client";

import { Building2, Flag, UserPlus, X } from "lucide-react";
import { StepCard } from "./StepCard";
import { SetDatesFlipCard } from "./SetDatesFlipCard";
import {
  LodgingThumbnail,
  CrewThumbnail,
  AgendaThumbnail,
} from "./thumbnails";
import { DOMAIN_COLORS } from "@/lib/domainColors";
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

  return (
    // Flush — no outer panel. The mock renders the guide directly under the
    // Itinerary header with full container width so the four step cards
    // breathe; an extra bordered box just shrinks them.
    <section data-testid="fresh-trip-guide">
      {/* Header — eyebrow + title + dismiss */}
      <header className="relative pr-10">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: DOMAIN_COLORS.home.color }}
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
          Add any of these in any order and they weave into one timeline.
          Dates frame it best — start there if you can — but nothing's
          blocked until you do.
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
        {/* Step 1 — Set dates (flip card; owns its own done state) */}
        <SetDatesFlipCard
          tripId={tripId}
          trip={trip}
          onOpenDatesSheet={onOpenDatesSheet}
          onTabChange={onTabChange}
        />

        {/* Step 2 — Add lodging (ghost CTA — only step 1 is the
            attention-grabber) */}
        <StepCard
          number={2}
          domain="lodging"
          title="Add lodging"
          body="Properties and rooms. Set nightly dates now or once your trip dates land."
          thumbnail={<LodgingThumbnail />}
          cta="Add lodging"
          ctaIcon={<Building2 size={14} strokeWidth={2} />}
          ctaVariant="ghost"
          onCta={() => onTabChange?.("lodging")}
          testId="guide-step-lodging"
        />

        {/* Step 3 — Invite the crew (ghost) */}
        <StepCard
          number={3}
          domain="crew"
          title="Invite the crew"
          body="Add everyone — they join, share travel, and split costs from their phone."
          thumbnail={<CrewThumbnail />}
          cta="Invite crew"
          ctaIcon={<UserPlus size={14} strokeWidth={2} />}
          ctaVariant="ghost"
          onCta={() => onTabChange?.("crew")}
          testId="guide-step-crew"
        />

        {/* Step 4 — Plan the agenda (ghost) */}
        <StepCard
          number={4}
          domain="agenda"
          title="Plan the agenda"
          body="Tee times, dinners, side games. Slot them onto days whenever you like."
          thumbnail={<AgendaThumbnail />}
          cta="Plan agenda"
          ctaIcon={<Flag size={14} strokeWidth={2} />}
          ctaVariant="ghost"
          onCta={() => onTabChange?.("schedule")}
          testId="guide-step-agenda"
        />
      </div>
    </section>
  );
}
