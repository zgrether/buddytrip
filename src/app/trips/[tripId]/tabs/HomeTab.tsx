"use client";

import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ItineraryPanel as LegacyItineraryPanel } from "../components/ItineraryPanel";
import { ItineraryPanel } from "./components/panels/ItineraryPanel";
import { TabHeader } from "@/components/TabHeader";
import type { TabProps } from "./types";

// ── HomeTab ──────────────────────────────────────────────────────────────
//
// Once a destination is locked the trip shares one panel surface (Quick Info
// + Itinerary) for its whole upcoming/now life. Travel plans used to live
// here as their own panel but have moved to the Crew tab — each member
// self-serves their own travel, and it still surfaces here as woven "arrival"
// items in the itinerary timeline.
//
// The Competition invitation no longer lives here either — the Comp tab is
// visible by default to canEdit users and owns the enable flow itself, so
// surfacing the CTA twice on the home tab was just clutter.
//
// idea            → IdeaZonePanel
// upcoming / now  → full panel layout
// past            → LegacyItineraryPanel (read-only bucketed view)

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  roleLoading,
  onTabChange,
  onOpenDatesSheet,
}: TabProps & { onTabChange?: (tab: string) => void; onEnableComp?: () => void; compActivated?: boolean; onOpenDatesSheet?: () => void }) {
  const status = getTripStatus(trip);

  // Prefetch ideas so IdeaZonePanel renders instantly in the idea phase — and
  // ONLY in the idea phase (#763). `IdeaZonePanel` is the sole reader (its own
  // two `ideas.list` observers), and it is returned only from the branch below,
  // so on a dated trip this fired on every load with nothing to consume it.
  // Declared after `status` so the gate can use it; the hook still runs on every
  // render either way, which is what the rules of hooks require.
  trpc.ideas.list.useQuery({ tripId: trip.id }, { enabled: status === "idea" });

  // Idea phase (no destination locked): render IdeaZonePanel only.
  if (status === "idea") {
    return (
      <IdeaZonePanel
        trip={trip}
        canEdit={canEditProp}
        isOwner={!!isOwner}
        onTabChange={onTabChange}
      />
    );
  }

  // upcoming + now share the same full panel surface; past falls through
  // to the read-only legacy view below.
  const showFullPanels = status === "upcoming" || status === "now";

  // FreshTripGuide owns its own welcoming header when it renders, so the
  // generic "You're driving this trip" TabHeader collapses to avoid two
  // intros stacked on top of each other. The guide renders for owners
  // who haven't dismissed it AND don't yet have a populated itinerary —
  // matched against the same gates ItineraryPanel uses.
  const guideOwnsHeader =
    !!isOwner && !!showFullPanels;

  // pt-1 (4px) lands the guide / ITINERARY eyebrow level with the
  // other tabs' TabHeader eyebrow (Crew/Lodging/Agenda/Receipts). The
  // wrapper previously used pt-3, which stacked 12px on top of the
  // parent's pt-4 and pushed the heading a few pixels below its peers.
  return (
    <div className="space-y-4 px-4 pt-1">
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
            // Pending is NOT member — see ItineraryPanel's branch. Without this,
            // `isOwner` reads false while role is in flight and the owner gets
            // the member empty state until it resolves.
            roleLoading={!!roleLoading}
            isActivated={!!trip.itinerary_enabled}
            onOpenDatesSheet={onOpenDatesSheet}
            onTabChange={onTabChange}
          />
        </>
      )}

      {/* ── PAST: keep the legacy ItineraryPanel; it's read-only and its
              bucketed layout is still useful after the trip. The Competition
              invitation no longer surfaces here — owners can spin up a
              retroactive scoreboard from the Comp tab directly. */}
      {!showFullPanels && (
        <LegacyItineraryPanel
          tripId={trip.id}
          tripStartDate={trip.start_date}
          status={status}
          onTabChange={onTabChange}
        />
      )}
    </div>
  );
}
