"use client";

import { useMemo, useState } from "react";
import { Building2, Flag, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
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
// invite the crew / add lodging / plan the agenda). Each card sizes to
// its own content; the Set Dates card grows in place when the user
// flips it open to reveal the calendar.

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

export function FreshTripGuide({
  tripId,
  trip,
  onOpenDatesSheet,
  onTabChange,
  onDismiss,
}: FreshTripGuideProps) {
  const datesSet = !!(trip.start_date && trip.end_date);
  const accent = DOMAIN_COLORS.home.color;

  // Poll-builder takeover: when the user taps "Set up date poll →" on
  // the dates flip card with ≥2 crew, the Set Dates card expands across
  // the whole grid and the other three steps hide until the poll is
  // committed or cancelled. Starting a poll is a "finish it" task —
  // splitting attention with the rest of the guide isn't useful.
  const [pollMode, setPollMode] = useState(false);

  // Destination string for the eyebrow + location graphic. Prefer the
  // explicit locked-destination location (semantic geographic string),
  // falling back to whatever the trip exposes.
  const destination =
    trip.locked_destination_location ?? trip.location ?? trip.title;
  const destinationUpper = destination?.toUpperCase() ?? "";

  // ── Done-state derivations for the Crew + Lodging steps ───────────
  //
  // Crew:    counts non-owner members. "3 added" type label.
  // Lodging: first lodging entry sorted by check-in date; CTA shows
  //          its property_name. Trips can have multiple properties
  //          (lake house → resort), so we surface the earliest one
  //          since that's the trip's opening lodging.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: logistics = [] } = trpc.logistics.list.useQuery({ tripId });

  const crewAdded = useMemo(() => {
    return (members as Array<{ role?: string | null }>).filter(
      (m) => m.role !== "Owner",
    ).length;
  }, [members]);
  const crewDone = crewAdded > 0;
  const crewDoneCta = `${crewAdded} added`;

  const firstLodging = useMemo(() => {
    const lodgings = (logistics as Array<{
      type?: string | null;
      property_name?: string | null;
      label?: string | null;
      check_in_time?: string | null;
    }>).filter((l) => l.type === "lodging");
    lodgings.sort((a, b) => {
      const ax = a.check_in_time ?? "";
      const bx = b.check_in_time ?? "";
      if (!ax && !bx) return 0;
      if (!ax) return 1;
      if (!bx) return -1;
      return ax.localeCompare(bx);
    });
    return lodgings[0];
  }, [logistics]);
  const lodgingDone = !!firstLodging;
  const lodgingDoneCta =
    firstLodging?.property_name ?? firstLodging?.label ?? "Lodging added";

  return (
    <section data-testid="fresh-trip-guide">
      {/* ── Welcome / planning header ─────────────────────────────────── */}
      <header
        className="relative flex items-start gap-4 pr-10 sm:gap-5"
      >
        <LocationGraphic location={destination} />
        {/* Text block — same typography cadence as the shared TabHeader
            (see src/components/TabHeader.tsx): 11px accent eyebrow,
            clamp-scaled semibold headline with -0.015em tracking, 15px
            body at 1.65 line-height, mb-3 rhythm between each row. */}
        <div className="min-w-0 flex-1">
          <p
            className="mb-3 text-[11px] font-semibold uppercase"
            style={{ color: accent, letterSpacing: "0.1em" }}
          >
            {datesSet ? "Get set up" : `New trip · ${destinationUpper}`}
          </p>
          <h2
            className="mb-3 font-semibold"
            style={{
              color: "var(--color-bt-text)",
              fontSize: "clamp(20px, 2.8vw, 26px)",
              lineHeight: 1.15,
              letterSpacing: "-0.015em",
            }}
          >
            {datesSet
              ? "Add what you've got"
              : `${destination} — nice pick.`}
          </h2>
          <p
            className="max-w-prose"
            style={{
              color: "var(--color-bt-text-dim)",
              fontSize: 15,
              lineHeight: 1.65,
            }}
          >
            {datesSet
              ? "Add any of these in any order and they weave into one timeline. Dates frame it best — start there if you can — but nothing's blocked until you do."
              : "That's the hard part done. Now let's build it out — set your dates, add lodging, pull in the crew. Each piece weaves into one day-by-day timeline, in whatever order you like."}
          </p>
        </div>
        {/* Toggle to the itinerary view. Sits in the top-right of the
            guide; pairs with the "← Setup guide" link rendered by
            ItineraryView's header when the guide is dismissed. Only
            shown once dates are locked — before that there's no
            itinerary to view, so the link would just lead to an empty
            state. */}
        {datesSet && (
          <button
            type="button"
            onClick={onDismiss}
            className="absolute right-0 top-0 inline-flex items-center gap-1 text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-accent)" }}
            data-testid="fresh-trip-guide-dismiss"
          >
            View itinerary →
          </button>
        )}
      </header>

      {/* ── Step grid — 1 col mobile, 2 col tablet, 4 col desktop.
              In pollMode the Set Dates card spans the full grid width
              and the other three steps drop out of the DOM. ─────────── */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Step 1 — Set dates (flip card; primary CTA) */}
        <div
          className={
            pollMode
              ? "sm:col-span-2 lg:col-span-4"
              : "sm:col-span-1 lg:col-span-1"
          }
        >
          <SetDatesFlipCard
            tripId={tripId}
            trip={trip}
            onOpenDatesSheet={onOpenDatesSheet}
            onTabChange={onTabChange}
            pollMode={pollMode}
            onPollExpand={() => setPollMode(true)}
            onPollCancel={() => setPollMode(false)}
          />
        </div>

        {/* Steps 2-4 hide while a poll is being built — starting a
            poll is a "finish it" task; the other steps just split
            attention. They return on cancel/launch. */}
        {!pollMode && (
          <>
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
              done={crewDone}
              doneCta={crewDone ? crewDoneCta : undefined}
              testId="guide-step-crew"
            />
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
              done={lodgingDone}
              doneCta={lodgingDone ? lodgingDoneCta : undefined}
              testId="guide-step-lodging"
            />
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
          </>
        )}
      </div>
    </section>
  );
}
