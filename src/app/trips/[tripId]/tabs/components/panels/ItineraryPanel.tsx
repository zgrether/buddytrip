"use client";

import { ListChecks } from "lucide-react";
import { ItineraryView } from "../ItineraryView";
import { DatePollCard } from "../DatePollCard";
import {
  FreshTripGuide,
  DismissedEmptyState,
  useGuideDismissed,
} from "../../../components/setup-guide";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface ItineraryPanelProps {
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  /** True once the owner has tapped "Add Itinerary" on the (legacy)
   *  invitation card. With the FreshTripGuide rollout we treat the empty
   *  itinerary as the default for owners, so this flag is no longer the
   *  primary gate — but it still routes legacy trips and members. */
  isActivated: boolean;
  /** Opens the existing DatesSheet — wired from the trip page. Passed
   *  through to FreshTripGuide's date flip-card poll branch. */
  onOpenDatesSheet?: () => void;
  /** Tab switcher — drives the Lodging / Crew / Agenda step CTAs in
   *  FreshTripGuide. */
  onTabChange?: (tab: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * ItineraryPanel — home tab panel for the day-by-day timeline.
 *
 * State machine (owner):
 *   - dates set OR isActivated → ItineraryView (real bookends + content).
 *     When the guide isn't dismissed, FreshTripGuide also renders above it
 *     so the owner can keep adding lodging/crew/agenda from the same spot.
 *   - no dates set + !dismissed → FreshTripGuide alone (the empty state).
 *   - no dates set + dismissed  → DismissedEmptyState (single dashed card
 *     with a Set-dates CTA and a "Show setup guide" restore link).
 *
 * Members still see the dim placeholder until the trip has real content.
 *
 * The legacy `isActivated` flag (itinerary_enabled) routes pre-existing
 * trips that already opted in; new trips treat the empty itinerary as the
 * default, with FreshTripGuide teaching the flow.
 */
export function ItineraryPanel({
  tripId,
  trip,
  isOwner,
  isActivated,
  onOpenDatesSheet,
  onTabChange,
}: ItineraryPanelProps) {
  const [dismissed, setDismissed] = useGuideDismissed(tripId);

  const datesSet = !!(trip.start_date && trip.end_date);
  const pollActive = !!trip.poll_mode;

  // ── Member path ─────────────────────────────────────────────────────
  // Priority order:
  //   1. Real bookends locked → ItineraryView (the trip has dates; show
  //      the day-by-day even if the poll flag is somehow still on,
  //      because dates landing is what members are waiting for).
  //   2. Poll is active → DatePollCard in vote/read mode. This is the
  //      one place the crew weighs in; the home tab IS the poll until
  //      it resolves. If the owner hasn't added windows yet, the card's
  //      empty state ("The organizer hasn't added any windows yet")
  //      handles that — members still see something useful instead of
  //      a generic dim placeholder.
  //   3. Otherwise → dim placeholder. The legacy `isActivated` flag is
  //      intentionally dropped from the member path: with the new poll
  //      flow, "itinerary is set up" should mean "dates are locked,"
  //      not "the owner flipped a legacy switch." Owners (below) still
  //      honor the flag for the rare in-flight legacy trip.
  if (!isOwner) {
    if (datesSet) {
      return <ItineraryView trip={trip} isOwner={false} />;
    }
    if (pollActive) {
      return <DatePollCard trip={trip} isOwner={false} />;
    }
    return (
      <DimPlaceholder text="Your itinerary will appear here once the organizer locks the trip dates." />
    );
  }

  // ── Owner: dates set OR activated — guide and itinerary toggle ────
  // Either/or: when the guide is up the itinerary is hidden, and vice
  // versa. The toggle lives in the top-right of whichever surface is
  // showing — "View itinerary →" on the guide, "← Setup guide" in the
  // ITINERARY header.
  if (datesSet || isActivated) {
    if (!dismissed) {
      return (
        <FreshTripGuide
          tripId={tripId}
          trip={trip}
          onTabChange={onTabChange}
          onDismiss={() => setDismissed(true)}
        />
      );
    }
    return (
      <ItineraryView
        trip={trip}
        isOwner={isOwner}
        headerAction={
          <button
            type="button"
            onClick={() => setDismissed(false)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-accent)" }}
            data-testid="guide-restore-link"
            aria-label="Show setup guide"
            title="Show setup guide"
          >
            <ListChecks size={14} strokeWidth={2} />
            Setup guide
          </button>
        }
      />
    );
  }

  // ── Owner: no dates yet ────────────────────────────────────────────
  if (dismissed) {
    return (
      <DismissedEmptyState
        onSetDates={() => onOpenDatesSheet?.()}
        onRestoreGuide={() => setDismissed(false)}
      />
    );
  }

  return (
    <FreshTripGuide
      tripId={tripId}
      trip={trip}
      onTabChange={onTabChange}
      onDismiss={() => setDismissed(true)}
    />
  );
}

// ── DimPlaceholder ───────────────────────────────────────────────────────

function DimPlaceholder({ text }: { text: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        opacity: 0.6,
      }}
    >
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {text}
      </p>
    </div>
  );
}

