"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import type { TripData } from "../../tabs/types";

/**
 * Shared setup-progress derivation for the Home setup-guide ⇄ itinerary flow.
 *
 * Four setup items: dates, crew, lodging, agenda. Drives:
 *  - the FreshTripGuide commit bar (`enough` = dates + lodging-or-agenda), and
 *  - the "Setup guide · N left" pill on the committed itinerary (`leftCount`).
 *
 * Queries are shared with the rest of the Home tab (React Query dedupes by
 * key), so this adds no extra network round-trips.
 */
export interface SetupProgress {
  datesDone: boolean;
  crewDone: boolean;
  lodgingDone: boolean;
  agendaDone: boolean;
  /** How many of the four setup items are not yet done. */
  leftCount: number;
  /** Dates + at least one of lodging/agenda → enough to commit to the itinerary. */
  enough: boolean;
}

export function useSetupProgress(tripId: string, trip: TripData): SetupProgress {
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  const { data: logistics = [] } = trpc.logistics.list.useQuery({ tripId });
  const { data: schedule = [] } = trpc.schedule.list.useQuery({ tripId });

  return useMemo(() => {
    const datesDone = !!(trip.start_date && trip.end_date);
    const crewDone =
      (members as Array<{ role?: string | null }>).filter((m) => m.role !== "Owner")
        .length > 0;
    const lodgingDone = (logistics as Array<{ type?: string | null }>).some(
      (l) => l.type === "lodging",
    );
    const agendaDone = (schedule as unknown[]).length > 0;

    const leftCount = [datesDone, crewDone, lodgingDone, agendaDone].filter(
      (d) => !d,
    ).length;
    const enough = datesDone && (lodgingDone || agendaDone);

    return { datesDone, crewDone, lodgingDone, agendaDone, leftCount, enough };
  }, [trip.start_date, trip.end_date, members, logistics, schedule]);
}
