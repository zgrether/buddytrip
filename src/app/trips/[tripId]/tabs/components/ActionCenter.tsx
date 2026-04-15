"use client";

import type { TripData } from "../types";
import { DatePollCard } from "./DatePollCard";

export interface ActionCenterProps {
  trip: TripData;
  canEdit: boolean;
}

/**
 * ActionCenter — member-facing "what needs your attention" surface shown
 * above PlanningSection during the PLANNING stage.
 *
 * Currently renders DatePollCard when the date poll is in progress or
 * dates have just been locked. Future cards (RsvpCard, TravelCard) will
 * follow the same shell pattern and plug in here.
 */
export function ActionCenter({ trip, canEdit }: ActionCenterProps) {
  const stage = trip.stage ?? "idea";
  if (stage !== "planning") return null;

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;

  // Only surface the date poll card when there's something to show.
  const showDatePollCard = pollMode || datesLocked;

  if (!showDatePollCard) return null;

  return (
    <section className="space-y-3">
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Action Center
      </p>
      {showDatePollCard && <DatePollCard trip={trip} canEdit={canEdit} />}
      {/* TODO: RsvpCard + TravelCard slot in here in later phases */}
    </section>
  );
}
