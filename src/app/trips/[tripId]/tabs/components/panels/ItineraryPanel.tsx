"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { ItineraryView } from "../ItineraryView";
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
  const utils = trpc.useUtils();
  // Suppress the unused-warning for the legacy disable mutation — kept on
  // standby for the (very rare) "back out of activation" flow if we wire
  // it back in later. For now FreshTripGuide replaces the activation UI.
  void useState; // imported above; tree-shaken if not used

  // Legacy disable hook — no longer surfaced in the UI, but kept available
  // so any prod data with itinerary_enabled=true and no content can still
  // be reverted via a future affordance without re-plumbing.
  const _disableItinerary = trpc.trips.disableItinerary.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, itinerary_enabled: false } : old,
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined)
        utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });
  void _disableItinerary;

  const datesSet = !!(trip.start_date && trip.end_date);

  // ── Member path ─────────────────────────────────────────────────────
  if (!isOwner) {
    // Show the live view as soon as there are bookends or content.
    if (datesSet || isActivated) {
      return <ItineraryView trip={trip} isOwner={false} />;
    }
    return (
      <DimPlaceholder text="Your itinerary will appear here once the trip organizer sets it up." />
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
          onOpenDatesSheet={onOpenDatesSheet}
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
            className="text-[12px] font-semibold transition-opacity hover:opacity-80"
            style={{ color: "var(--color-bt-accent)" }}
            data-testid="guide-restore-link"
          >
            ← Setup guide
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
      onOpenDatesSheet={onOpenDatesSheet}
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

