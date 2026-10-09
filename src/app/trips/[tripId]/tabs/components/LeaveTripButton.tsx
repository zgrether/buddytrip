"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { markLeavingTrip, unmarkLeavingTrip } from "@/components/TripMembershipGate";
import { clearLastTripPointer } from "@/lib/lastTripPointer";
import { resetTripGameState } from "@/lib/gameConfigHash";
import { DepartureWarning } from "./DepartureWarning";

/**
 * Leave trip (PR 8d-3, ruling 3) — the viewer leaves on their own, through the
 * same archive an organizer's removal uses (`tripMembers.leave`).
 *
 * Lives on the YOU tile, the one place every member — Owner, Organizer or
 * Member — sees their own row on the Crew tab, and under the ideas-phase
 * roster (`IdeaZonePanel`), which has no Crew tab.
 *
 * Arming reads `departureSummary` for the viewer, and only then: what they
 * would leave behind is worth one read when someone starts to leave, not on
 * every visit to the Crew tab.
 *   - The OWNER is refused (ruling 3), and arming says why and what to do —
 *     the same sentence the archive's refusal gives (`ownerLeaveRefusal`).
 *   - Everyone else gets the warning above the confirm: history stays, they
 *     are taken out of anything undecided, and — ruling 2's sentence — they
 *     won't see the trip's expenses after they go.
 *
 * On success the trip is gone from their list, so they land on the dashboard.
 */
export function LeaveTripButton({ tripId, userId }: { tripId: string; userId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [wanted, setWanted] = useState(false);

  const { data: summary, isFetching } = trpc.tripMembers.departureSummary.useQuery(
    { tripId, userId },
    // Fresh each time it is armed, for the reason MemberEditor's copy gives
    // (#1034b): what it lists changes through writers nobody could enumerate.
    { enabled: wanted, staleTime: 0, refetchOnMount: "always" }
  );

  const leave = trpc.tripMembers.leave.useMutation({
    // Before the call, not after: see `markLeavingTrip`.
    onMutate: () => markLeavingTrip(tripId),
    onError: () => unmarkLeavingTrip(tripId),
    onSuccess: () => {
      clearLastTripPointer();
      void utils.trips.list.invalidate();
      // Leaving vacates their seats in the trip's unfinished games (the
      // archive), so this device's cached game state for the trip is stale —
      // the same reset a removal does (#1507).
      resetTripGameState(utils, tripId);
      router.replace("/dashboard");
    },
  });

  const checking = wanted && (isFetching || !summary);

  return (
    <div>
      <ConfirmDeleteButton
        label="Leave trip"
        confirmLabel="Leave"
        pendingLabel="Leaving…"
        icon={<LogOut size={14} />}
        onArm={() => setWanted(true)}
        // Holds the confirm until the summary has answered, so nobody leaves
        // past a warning that had not arrived yet.
        pending={leave.isPending || checking}
        onConfirm={() => leave.mutate({ tripId })}
        blocked={summary?.ownerRefusal ? <OwnerCannotLeave message={summary.ownerRefusal} /> : undefined}
        warning={
          summary && !checking ? (
            <DepartureWarning who="self" history={summary.history} />
          ) : (
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Checking what you&rsquo;d leave behind…
            </p>
          )
        }
        testId="leave-trip"
      />
      {leave.error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: "var(--color-bt-danger)" }}>
          {leave.error.message}
        </p>
      )}
    </div>
  );
}

function OwnerCannotLeave({ message }: { message: string }) {
  return (
    <>
      <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        You can&rsquo;t leave yet
      </p>
      <p className="mt-1.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {message}
      </p>
    </>
  );
}
