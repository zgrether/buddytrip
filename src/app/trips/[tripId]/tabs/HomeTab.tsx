"use client";

import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ItineraryPanel as LegacyItineraryPanel } from "../components/ItineraryPanel";
import { ItineraryPanel } from "./components/panels/ItineraryPanel";
import { GettingTherePanel } from "./components/panels/GettingTherePanel";
import { QuickInfoPanel } from "./components/panels/QuickInfoPanel";
import { TabHeader } from "@/components/TabHeader";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import type { TabProps } from "./types";

// ── HomeTab ──────────────────────────────────────────────────────────────
//
// PLANNING and GOING stages share the same panel surface (Quick Info,
// Travel Plans, Itinerary). Previously PLANNING showed a four-tile basic-
// planning grid (PlanningGrid) with a "View Itinerary →" upgrade modal;
// that scaffolding has been removed and trips go directly from IDEA → full
// panel surface when the destination is locked.
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
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; compActivated?: boolean; onOpenChat?: () => void; onWriteInvitation?: () => void; onAdvanceToGoing?: () => void; actionCenterTitleAction?: React.ReactNode }) {
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

  return (
    <div className="space-y-4 px-4">
      {showFullPanels && (
        <>
          {/* Owner intro — same marketing-style typography as the other tabs'
              TabHeader, but without an eyebrow (the trip header above already
              announces context). Reinforces what the owner controls and the
              fact that the crew sees only what's published. Members and
              planners don't see this — it's owner-coaching copy. */}
          {isOwner && (
            <TabHeader
              headline="You're driving this trip"
              body="Lock in dates and destination, invite the crew, and add logistics as they firm up. You decide what the crew sees — from travel plans to a live competition leaderboard — and everyone stays in sync in real time."
              testId="home-owner-intro"
            />
          )}

          {/* Quick Info — most-glanced surface (door codes, addresses) */}
          <QuickInfoPanel
            tripId={trip.id}
            isOwner={!!isOwner}
            isActivated={!!trip.quick_info_enabled}
          />

          {/* Travel Plans + Itinerary layout.
              - When BOTH are activated → side-by-side grid (Travel 1/3, Itin 2/3).
                The asymmetric split fits the real shapes: a compact travel
                widget on the left, a tall day-by-day timeline on the right.
              - When either is still in its invitation-card state → stack
                vertically full-width. Mismatched widths (a small dashed CTA
                pinned next to a populated panel) looked awkward, and the
                invitation card is designed for the full content width anyway.
              - When the owner has hidden Travel Plans from crew →
                Itinerary-only, full width.
              minmax(0,…) stops filter-pill min-content from widening cols. */}
          {(() => {
            const showTravelColumn =
              !!isOwner ||
              (trip as { travel_plans_crew_visible?: boolean | null }).travel_plans_crew_visible !== false;

            if (!showTravelColumn) {
              return (
                <ItineraryPanel
                  tripId={trip.id}
                  trip={trip}
                  isOwner={!!isOwner}
                  isActivated={!!trip.itinerary_enabled}
                />
              );
            }

            const bothExpanded =
              !!trip.getting_there_enabled && !!trip.itinerary_enabled;

            const gettingThere = (
              <GettingTherePanel
                tripId={trip.id}
                trip={trip}
                isOwner={!!isOwner}
                isActivated={!!trip.getting_there_enabled}
              />
            );
            const itinerary = (
              <ItineraryPanel
                tripId={trip.id}
                trip={trip}
                isOwner={!!isOwner}
                isActivated={!!trip.itinerary_enabled}
              />
            );

            return bothExpanded ? (
              // items-stretch (CSS grid default) + h-full on the cell wrappers
              // chains the row height through the panel structure so the
              // dashed empty-state boxes match heights. Empty space lands
              // INSIDE the shorter box (below its mock tiles), not as
              // whitespace between cards.
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="h-full">{gettingThere}</div>
                <div className="h-full">{itinerary}</div>
              </div>
            ) : (
              <div className="space-y-4">
                {gettingThere}
                {itinerary}
              </div>
            );
          })()}
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
