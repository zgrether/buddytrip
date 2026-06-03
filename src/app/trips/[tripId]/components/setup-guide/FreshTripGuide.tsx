"use client";

import { useMemo } from "react";
import { Building2, Flag, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { StepCard } from "./StepCard";
import { SetDatesFlipCard } from "./SetDatesFlipCard";
import { DatePollCard } from "../../tabs/components/DatePollCard";
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
  /** Navigate to a tab — drives the Lodging / Crew / Agenda CTAs and
   *  the Poll-branch "Add the crew first" redirect. */
  onTabChange?: (tab: string) => void;
  /** Owner dismissed the guide. */
  onDismiss: () => void;
}

export function FreshTripGuide({
  tripId,
  trip,
  onTabChange,
  onDismiss,
}: FreshTripGuideProps) {
  const datesSet = !!(trip.start_date && trip.end_date);
  const accent = DOMAIN_COLORS.home.color;

  // Poll-builder takeover: derived purely from trip.poll_mode. The
  // server flag flips true the moment the owner taps "Set up date poll"
  // — activatePoll's tRPC mutation does an optimistic cache write that
  // sets trip.poll_mode = true synchronously, so the takeover feels
  // instant without needing a separate local latch. Clearing follows
  // the same path: locking a window / cancelling the poll / picking
  // dates via DatesSheet all set poll_mode = false and the surface
  // collapses back to the normal grid.
  const pollMode = !!trip.poll_mode;

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
      label?: string | null;
      property_name?: string | null;
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
  // Read from `label` — AddPropertySheet stores the user-typed title in
  // the `label` column. `property_name` is misnamed: LodgingPanel writes
  // the "sleeps" capacity number into it (see LodgingPanel.handleCreate).
  // Worth a follow-up rename in the schema, but for now `label` is the
  // right field for "the property's title."
  const lodgingDoneCta =
    firstLodging?.label ?? firstLodging?.property_name ?? "Lodging added";

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
          {/* Three-stage header copy. Priority order:
                pollMode → poll-in-flight ("Now let's lock the dates")
                datesSet → bookends locked ("Add what you've got")
                otherwise → fresh trip ("Destination — nice pick.")
              pollMode wins over datesSet because the only way to be in
              both states is a race; the poll surface is what's actually
              showing under the header, so the copy should match it. */}
          <p
            className="mb-3 text-[11px] font-semibold uppercase"
            style={{ color: accent, letterSpacing: "0.1em" }}
          >
            {pollMode
              ? "Date poll"
              : datesSet
                ? "Get set up"
                : `New trip · ${destinationUpper}`}
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
            {pollMode
              ? "Now let's lock the dates"
              : datesSet
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
            {pollMode
              ? "The crew's weighing in on which window works — pick the winner once it's clear. Everything else can fill in around it."
              : datesSet
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

      {/* Body — split on pollMode:
            • Poll active → DatePollCard rendered flush, no outer card
              chrome, no "Set your dates" header. The FreshTripGuide
              header up top already announces the poll context ("Now
              let's lock the dates").
            • Otherwise → the four-up step grid. */}
      {pollMode ? (
        <div className="mt-4">
          <DatePollCard
            trip={trip}
            isOwner
            onManageCrew={onTabChange ? () => onTabChange("crew") : undefined}
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Step 1 — Set dates (flip card; primary CTA) */}
          {/* SetDatesFlipCard's onPollExpand / onPollCancel are no-ops
              now — the takeover is purely server-state-driven via
              activatePoll's optimistic write to trip.poll_mode, which
              FreshTripGuide reads as `pollMode` and branches on
              upstream. The callbacks remain on the interface for
              future "local optimism" flows. */}
          <SetDatesFlipCard
            tripId={tripId}
            trip={trip}
            onTabChange={onTabChange}
            pollMode={false}
            onPollExpand={() => {}}
            onPollCancel={() => {}}
          />
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
        </div>
      )}
    </section>
  );
}
