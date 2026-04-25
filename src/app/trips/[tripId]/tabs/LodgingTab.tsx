"use client";

import { LodgingPanel } from "../components/LodgingPanel";
import type { TabProps } from "./types";

/**
 * Lodging tab — dedicated home for the "where are we staying" surface.
 *
 * Lives between Crew and Schedule in the tab bar (see TripTabBar). We
 * pulled this out of HomeTab so the main home flow can stay focused on
 * trip status + the upcoming itinerary surface without the lodging
 * compare-and-confirm UI pushing everything else down.
 *
 * The panel renders in `inline` mode so it reads as a top-level section
 * (LODGING header + blurb + add-on-top) rather than the collapsible
 * PlanningRow that the non-inline variant produces. The panel keeps
 * working through all post-idea stages — in going/now/past it still
 * surfaces the same cards, just with confirmation already done.
 */
export function LodgingTab({ trip, canEdit, embedded }: TabProps & { embedded?: boolean }) {
  return (
    <div className={embedded ? undefined : "px-4"}>
      <LodgingPanel
        tripId={trip.id}
        canEdit={canEdit}
        isOpen={true}
        onToggle={() => {}}
        inline
        hideHeader={embedded}
      />
    </div>
  );
}
