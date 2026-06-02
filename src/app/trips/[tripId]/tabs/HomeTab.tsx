"use client";

import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ItineraryPanel as LegacyItineraryPanel } from "../components/ItineraryPanel";
import { ItineraryPanel } from "./components/panels/ItineraryPanel";
import { TabHeader } from "@/components/TabHeader";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import type { TabProps } from "./types";

// ── HomeTab ──────────────────────────────────────────────────────────────
//
// PLANNING and GOING stages share the same panel surface (Quick Info +
// Itinerary). Travel plans used to live here as their own panel but have
// moved to the Crew tab — each member self-serves their own travel, and it
// still surfaces here as woven "arrival" items in the itinerary timeline.
// Previously PLANNING showed a four-tile basic-planning grid (PlanningGrid)
// with a "View Itinerary →" upgrade modal; that scaffolding has been removed
// and trips go directly from IDEA → full panel surface when the destination
// is locked.
//
// The Competition invitation no longer lives here either — the Comp tab is
// visible by default to canEdit users and owns the enable flow itself, so
// surfacing the CTA twice on the home tab was just clutter.
//
// IDEA   → IdeaZonePanel
// PLANNING / GOING(going|now) → full panel layout
// PAST / SAVED → LegacyItineraryPanel (read-only bucketed view)

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onOpenChat,
  onOpenDatesSheet,
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; compActivated?: boolean; onOpenChat?: () => void; onWriteInvitation?: () => void; onAdvanceToGoing?: () => void; actionCenterTitleAction?: React.ReactNode; onOpenDatesSheet?: () => void }) {
  // Prefetch ideas so IdeaZonePanel renders instantly when stage === "idea".
  trpc.ideas.list.useQuery({ tripId: trip.id });

  const status = getTripStatus(trip);
  const stage = trip.stage ?? "idea";

  // IDEA stage: render IdeaZonePanel only — no planning rows
  if (stage === "idea") {
    return (
      <IdeaZonePanel
        trip={trip}
        canEdit={canEditProp}
        isOwner={!!isOwner}
        onTabChange={onTabChange}
        onOpenChat={onOpenChat}
      />
    );
  }

  // PLANNING + GOING(going|now) share the same panel surface.
  const showFullPanels =
    stage === "planning" ||
    (stage === "going" && (status === "going" || status === "now"));

  // FreshTripGuide owns its own welcoming header when it renders, so the
  // generic "You're driving this trip" TabHeader collapses to avoid two
  // intros stacked on top of each other. The guide renders for owners
  // who haven't dismissed it AND don't yet have a populated itinerary —
  // matched against the same gates ItineraryPanel uses.
  const guideOwnsHeader =
    !!isOwner && !!showFullPanels;

  return (
    <div className="space-y-4 px-4 pt-3">
      {showFullPanels && (
        <>
          {/* Owner intro — only shown when FreshTripGuide isn't (because
              the guide carries its own welcoming header that already
              announces context). */}
          {isOwner && !guideOwnsHeader && (
            <TabHeader
              headline="You're driving this trip"
              body="Lock in dates and destination, invite the crew, and add logistics as they firm up. You decide what the crew sees — from travel plans to a live competition leaderboard — and everyone stays in sync in real time."
              testId="home-owner-intro"
            />
          )}

          {/* Quick Info moved into the trip header dock — see
              TripHeaderDock. The old QuickInfoPanel + QuickInfoSection
              are removed; the header dock owns the tile rail now. */}

          {/* Itinerary — full width. Travel plans moved to the Crew tab
              (each member self-serves their own); travel still surfaces here
              as woven "arrival" items inside the itinerary timeline. */}
          <ItineraryPanel
            tripId={trip.id}
            trip={trip}
            isOwner={!!isOwner}
            isActivated={!!trip.itinerary_enabled}
            onOpenDatesSheet={onOpenDatesSheet}
            onTabChange={onTabChange}
          />
        </>
      )}

      {/* ── PAST / SAVED: keep the legacy ItineraryPanel; it's read-only
              and its bucketed layout is still useful after the trip.
              The Competition invitation no longer surfaces here — owners can
              spin up a retroactive scoreboard from the Comp tab directly. */}
      {!showFullPanels && stage !== "idea" && (
        <LegacyItineraryPanel
          tripId={trip.id}
          tripStartDate={trip.start_date}
          stage={stage}
          status={status}
          onTabChange={onTabChange}
        />
      )}
    </div>
  );
}
