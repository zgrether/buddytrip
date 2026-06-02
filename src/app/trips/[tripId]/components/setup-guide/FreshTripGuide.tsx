"use client";

import { Building2, Flag, UserPlus, X } from "lucide-react";
import { StepCard } from "./StepCard";
import { SetDatesFlipCard } from "./SetDatesFlipCard";
import {
  LodgingThumbnail,
  CrewThumbnail,
  AgendaThumbnail,
} from "./thumbnails";
import { LocationGraphic } from "./LocationGraphic";
import { DOMAIN_COLORS } from "@/lib/domainColors";
import type { TripData } from "../../tabs/types";

// ── FreshTripGuide ───────────────────────────────────────────────────────
//
// Owner's empty-itinerary teaching surface. Two states:
//
//   No dates yet → welcome header: location graphic on the left,
//     "NEW TRIP · DESTINATION" eyebrow + "Destination — nice pick." +
//     a one-sentence welcome on the right.
//
//   Dates set    → planning header: same location graphic, "GET SET UP"
//     eyebrow + "Add what you've got" + the in-progress copy.
//
// Below the header, a 4-up responsive grid of step cards (set dates /
// invite the crew / add lodging / plan the agenda). Every card is the
// same fixed height as the flipped Set-dates card so nothing jumps when
// the picker opens.

export interface FreshTripGuideProps {
  tripId: string;
  trip: TripData;
  /** Opens the existing DatesSheet — used by the Poll branch (≥2 crew). */
  onOpenDatesSheet?: () => void;
  /** Navigate to a tab — drives the Lodging / Crew / Agenda CTAs and
   *  the Poll-branch "Add the crew first" redirect. */
  onTabChange?: (tab: string) => void;
  /** Owner dismissed the guide. */
  onDismiss: () => void;
}

// Match the flipped Set-dates card height so every step card holds the
// same shape before AND after the picker opens. Tuned to fit calendar +
// presets + Save row at the picker's tightest layout.
const CARD_MIN_H = 420;

export function FreshTripGuide({
  tripId,
  trip,
  onOpenDatesSheet,
  onTabChange,
  onDismiss,
}: FreshTripGuideProps) {
  const datesSet = !!(trip.start_date && trip.end_date);
  const accent = DOMAIN_COLORS.home.color;

  // Destination string for the eyebrow + location graphic. Prefer the
  // explicit locked-destination location (semantic geographic string),
  // falling back to whatever the trip exposes.
  const destination =
    trip.locked_destination_location ?? trip.location ?? trip.title;
  const destinationUpper = destination?.toUpperCase() ?? "";

  return (
    <section data-testid="fresh-trip-guide">
      {/* ── Welcome / planning header ─────────────────────────────────── */}
      <header
        className="relative flex items-start gap-4 pr-10 sm:gap-5"
      >
        <LocationGraphic location={destination} />
        <div className="min-w-0 flex-1 pt-1">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.10em]"
            style={{ color: accent }}
          >
            {datesSet ? "Get set up" : `New trip · ${destinationUpper}`}
          </p>
          <h2
            className="mt-1 text-[22px] font-bold leading-tight sm:text-[24px]"
            style={{ color: "var(--color-bt-text)" }}
          >
            {datesSet
              ? "Add what you've got"
              : `${destination} — nice pick.`}
          </h2>
          <p
            className="mt-2 text-[13px] leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {datesSet
              ? "Add any of these in any order and they weave into one timeline. Dates frame it best — start there if you can — but nothing's blocked until you do."
              : "That's the hard part done. Now let's build it out — set your dates, add lodging, pull in the crew. Each piece weaves into one day-by-day timeline, in whatever order you like."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss setup guide"
          className="absolute right-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{
            color: "var(--color-bt-text-dim)",
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
          data-testid="fresh-trip-guide-dismiss"
        >
          <X size={16} />
        </button>
      </header>

      {/* ── Step grid — 1 col mobile, 2 col tablet, 4 col desktop ─────── */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Step 1 — Set dates (flip card; primary CTA) */}
        <SetDatesFlipCard
          tripId={tripId}
          trip={trip}
          onOpenDatesSheet={onOpenDatesSheet}
          onTabChange={onTabChange}
          minHeight={CARD_MIN_H}
        />

        {/* Step 2 — Invite the crew (ghost) */}
        <StepCard
          number={2}
          domain="crew"
          title="Invite the crew"
          body="Add everyone — they join, share travel, and split costs from their phone."
          thumbnail={<CrewThumbnail />}
          cta="Invite crew"
          ctaIcon={<UserPlus size={14} strokeWidth={2} />}
          ctaVariant="ghost"
          onCta={() => onTabChange?.("crew")}
          minHeight={CARD_MIN_H}
          testId="guide-step-crew"
        />

        {/* Step 3 — Add lodging (ghost) */}
        <StepCard
          number={3}
          domain="lodging"
          title="Add lodging"
          body="Properties and rooms. Set nightly dates now or once your trip dates land."
          thumbnail={<LodgingThumbnail />}
          cta="Add lodging"
          ctaIcon={<Building2 size={14} strokeWidth={2} />}
          ctaVariant="ghost"
          onCta={() => onTabChange?.("lodging")}
          minHeight={CARD_MIN_H}
          testId="guide-step-lodging"
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
          minHeight={CARD_MIN_H}
          testId="guide-step-agenda"
        />
      </div>
    </section>
  );
}
