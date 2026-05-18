"use client";

import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ItineraryPanel as LegacyItineraryPanel } from "../components/ItineraryPanel";
import { ItineraryPanel } from "./components/panels/ItineraryPanel";
import { GettingTherePanel } from "./components/panels/GettingTherePanel";
import { QuickInfoPanel } from "./components/panels/QuickInfoPanel";
import { CompetitionInvitationCard } from "@/components/competition/CompetitionInvitationCard";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import type { TabProps } from "./types";

// ── HomeTab ──────────────────────────────────────────────────────────────
//
// PLANNING and GOING stages now share the same panel surface (Quick Info,
// Travel Plans, Itinerary, Competition CTA). Previously PLANNING showed a
// four-tile basic-planning grid (PlanningGrid) with a "View Itinerary →"
// upgrade modal; that scaffolding has been removed and trips go directly
// from IDEA → full panel surface when the destination is locked.
//
// IDEA   → IdeaZonePanel
// PLANNING / GOING(going|now) → full panel layout
// PAST / SAVED → LegacyItineraryPanel (read-only bucketed view)

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onEnableComp,
  compActivated,
  onOpenChat,
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; compActivated?: boolean; onOpenChat?: () => void; onWriteInvitation?: () => void; onAdvanceToGoing?: () => void; actionCenterTitleAction?: React.ReactNode }) {
  trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId: trip.id });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  const status = getTripStatus(trip);
  const stage = trip.stage ?? "idea";

  // hasItineraryContent — drives the locked vs invitation state on
  // ItineraryPanel. True when ANY of dates / lodging / schedule / shared
  // travel exists.
  const hasItineraryContent =
    !!trip.start_date ||
    scheduleItems.length > 0 ||
    (members as Array<{ travel_mode?: string | null }>).some((m) => !!m.travel_mode);

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
          {/* Quick Info — most-glanced surface (door codes, addresses) */}
          <QuickInfoPanel
            tripId={trip.id}
            isOwner={!!isOwner}
            isDismissed={!!trip.quick_info_dismissed}
          />

          {/* Two-column layout: Travel Plans (1/3) + Itinerary (2/3).
              Stacks single-column on mobile — Travel Plans appears first.
              When the owner has hidden Travel Plans from crew the left column
              is omitted entirely so Itinerary expands to full width.
              minmax(0,…) stops filter-pill min-content from widening columns. */}
          {(() => {
            const showTravelColumn =
              !!isOwner ||
              (trip as { travel_plans_crew_visible?: boolean | null }).travel_plans_crew_visible !== false;
            return showTravelColumn ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div style={{ alignSelf: "start" }}>
                  <GettingTherePanel
                    tripId={trip.id}
                    trip={trip}
                    isOwner={!!isOwner}
                    isActivated={!!trip.getting_there_enabled}
                    hasDates={!!trip.start_date}
                  />
                </div>
                <div>
                  <ItineraryPanel
                    tripId={trip.id}
                    trip={trip}
                    isOwner={!!isOwner}
                    isActivated={!!trip.itinerary_enabled}
                    hasContent={hasItineraryContent}
                  />
                </div>
              </div>
            ) : (
              <ItineraryPanel
                tripId={trip.id}
                trip={trip}
                isOwner={!!isOwner}
                isActivated={!!trip.itinerary_enabled}
                hasContent={hasItineraryContent}
              />
            );
          })()}

          <CompetitionInvitationCard
            canEdit={canEditProp}
            isActivated={!!compActivated}
            onEnable={onEnableComp}
          />
        </>
      )}

      {/* ── PAST / SAVED: keep the legacy ItineraryPanel; it's read-only
              and its bucketed layout is still useful after the trip.
              Comp invitation still surfaces here so the owner can spin
              up a retroactive scoreboard for past trips. */}
      {!showFullPanels && stage !== "idea" && (
        <>
          <LegacyItineraryPanel
            tripId={trip.id}
            tripStartDate={trip.start_date}
            stage={stage}
            status={status}
            onTabChange={onTabChange}
          />
          <CompetitionInvitationCard
            canEdit={canEditProp}
            isActivated={!!compActivated}
            onEnable={onEnableComp}
          />
        </>
      )}
    </div>
  );
}
