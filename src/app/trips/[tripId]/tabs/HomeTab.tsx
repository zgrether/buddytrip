"use client";

import { trpc } from "@/lib/trpc-client";
import { getTripStatus } from "@/components/StatusBadge";
import IdeaZonePanel from "../components/IdeaZonePanel";
import { ItineraryPanel as LegacyItineraryPanel } from "../components/ItineraryPanel";
import { PlanningGrid } from "./components/PlanningGrid";
import { ItineraryPanel } from "./components/panels/ItineraryPanel";
import { GettingTherePanel } from "./components/panels/GettingTherePanel";
import { QuickInfoPanel } from "./components/panels/QuickInfoPanel";
import { CompetitionPanel } from "./components/panels/CompetitionPanel";
import type { TripDisplayStatus } from "@/lib/tripStatus";
import type { TabProps } from "./types";

// ── HomeTab ──────────────────────────────────────────────────────────────

export function HomeTab({
  trip,
  canEdit: canEditProp,
  isOwner,
  onTabChange,
  onEnableComp,
  compActivated,
  onOpenChat,
  onWriteInvitation,
  onAdvanceToGoing,
  actionCenterTitleAction,
}: TabProps & { displayStatus?: TripDisplayStatus; onTabChange?: (tab: string) => void; onEnableComp?: () => void; compActivated?: boolean; onOpenChat?: () => void; onWriteInvitation?: () => void; onAdvanceToGoing?: () => void; actionCenterTitleAction?: React.ReactNode }) {
  trpc.ideas.list.useQuery({ tripId: trip.id });
  const { data: reservations = [] } = trpc.reservations.list.useQuery({ tripId: trip.id });
  const { data: scheduleItems = [] } = trpc.schedule.list.useQuery({ tripId: trip.id });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  const status = getTripStatus(trip);
  const stage = trip.stage ?? "idea";

  // hasItineraryContent — drives the locked vs invitation state on
  // ItineraryPanel. True when ANY of dates / lodging / schedule / shared
  // travel exists.
  const hasItineraryContent =
    !!trip.start_date ||
    reservations.length > 0 ||
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

  return (
    <div className="space-y-4 px-4">
      {/* ── PLANNING stage: planning_tier picks the surface.
              - basic    → four-tile PlanningGrid (current default)
              - advanced → full tab view (PAYWALL SEAM — not yet implemented;
                renders PlanningGrid as a fallback so the tier is end-to-end
                exercisable from the dev toggle until the upgrade flow exists).
              Replaces the old ActionCenter / PlanningSection treatment.      */}
      {stage === "planning" && (trip.planning_tier ?? "basic") === "basic" && (
        <PlanningGrid
          trip={trip}
          canEdit={canEditProp}
          isOwner={!!isOwner}
          onTabChange={onTabChange}
          onAdvanceToGoing={onAdvanceToGoing}
        />
      )}
      {stage === "planning" && trip.planning_tier === "advanced" && (
        // PAYWALL SEAM: planning_tier === 'advanced' unlocks full tab view.
        // Until that view is built, fall through to the basic grid so the
        // dev toggle has visible effect once the advanced surface lands.
        <PlanningGrid
          trip={trip}
          canEdit={canEditProp}
          isOwner={!!isOwner}
          onTabChange={onTabChange}
          onAdvanceToGoing={onAdvanceToGoing}
        />
      )}

      {/* ── GOING / NOW stage: panel system.
              Each panel handles its own locked/invitation/live state.
              The owner-nudge for unlinked crew has moved into the Crew
              tab (with a dot on the tab bar) — do not surface it here. */}
      {stage === "going" && (status === "going" || status === "now") && (
        <>
          {/* Quick Info — most-glanced surface (door codes, addresses) */}
          <QuickInfoPanel
            tripId={trip.id}
            isOwner={!!isOwner}
            isDismissed={!!trip.quick_info_dismissed}
          />
          {/* Getting There — sits between Quick Info and the bigger
              Itinerary panel. Compresses down to the user's own arrival
              row once they've shared. */}
          <GettingTherePanel
            tripId={trip.id}
            trip={trip}
            isOwner={!!isOwner}
            isActivated={!!trip.getting_there_enabled}
            hasDates={!!trip.start_date}
            onOpenDatesModal={() => onTabChange?.("schedule")}
          />
          <ItineraryPanel
            tripId={trip.id}
            trip={trip}
            isOwner={!!isOwner}
            isActivated={!!trip.itinerary_enabled}
            hasContent={hasItineraryContent}
          />
          <CompetitionPanel
            isOwner={!!isOwner}
            isActivated={!!trip.event_id || !!compActivated}
            onSetupComp={onEnableComp}
          />
        </>
      )}

      {/* ── PAST / SAVED: keep the legacy ItineraryPanel; it's read-only
              and its bucketed layout is still useful after the trip.
              Competition panel still surfaces here too — same component
              as going/now, the activation flag (event_id) is what counts. */}
      {stage !== "idea" && stage !== "planning" && status !== "going" && status !== "now" && (
        <>
          <LegacyItineraryPanel
            tripId={trip.id}
            tripStartDate={trip.start_date}
            stage={stage}
            status={status}
            onTabChange={onTabChange}
          />
          <CompetitionPanel
            isOwner={!!isOwner}
            isActivated={!!trip.event_id || !!compActivated}
            onSetupComp={onEnableComp}
          />
        </>
      )}
    </div>
  );
}
