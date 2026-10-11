"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { markLeavingTrip, unmarkLeavingTrip } from "@/components/TripMembershipGate";
import { useOpenTripSettings, type TripSettingsView } from "@/components/TripSettingsOpener";
import { clearLastTripPointer } from "@/lib/lastTripPointer";
import { resetTripGameState } from "@/lib/gameConfigHash";
import { DepartureWarning } from "./DepartureWarning";

/**
 * Leave trip (PR 8d-3, ruling 3) — the viewer leaves on their own, through the
 * same archive an organizer's removal uses (`tripMembers.leave`).
 *
 * A small red text link at the foot of the YOU card on the Crew tab (Zach's
 * look: a card every member sees should not carry a full-width danger button),
 * and under the ideas-phase roster (`IdeaZonePanel`), which has no Crew tab.
 *
 * Arming reads `departureSummary` for the viewer, and only then: one read when
 * someone starts to leave, not one per visit to the Crew tab.
 *   - The OWNER is refused (ruling 3): the sentence says why, and its "Trip
 *     settings" opens the screen it names (`settingsView`).
 *   - Everyone else confirms "Leave {trip}?", plus one line when they are in
 *     an expense (`DepartureWarning`).
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
    // (#1034b): what it counts changes through writers nobody could enumerate.
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
        appearance="link"
        label="Leave trip"
        confirmLabel="Leave"
        pendingLabel="Leaving…"
        onArm={() => setWanted(true)}
        // Holds the confirm until the summary has answered, so nobody confirms
        // a sheet whose title and money line had not arrived yet.
        pending={leave.isPending || checking}
        onConfirm={() => leave.mutate({ tripId })}
        blocked={
          summary?.ownerRefusal ? (
            <OwnerCannotLeave
              message={summary.ownerRefusal.message}
              view={summary.ownerRefusal.settingsView}
            />
          ) : undefined
        }
        warning={
          summary && !checking ? (
            <DepartureWarning who="self" summary={summary} />
          ) : (
            <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
              Checking…
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

/**
 * The Owner's refusal, with "Trip settings" in it made a link to the screen it
 * names. The sentence is the server's (`ownerLeaveRefusal`), so the words stay
 * one copy; this only finds the place name in it. Without an opener (none is
 * provided outside the trip page) it renders as plain text.
 */
export function OwnerCannotLeave({ message, view }: { message: string; view: TripSettingsView }) {
  const open = useOpenTripSettings();
  return (
    <p className="text-sm" style={{ color: "var(--color-bt-text)" }}>
      {linkSettings(message, open ? () => open(view) : null)}
    </p>
  );
}

const PLACE = "Trip settings";

/** Exported for tests. */
export function linkSettings(message: string, onOpen: (() => void) | null): ReactNode {
  const at = message.indexOf(PLACE);
  if (at < 0 || !onOpen) return message;
  return (
    <>
      {message.slice(0, at)}
      <button
        type="button"
        onClick={onOpen}
        data-testid="leave-open-trip-settings"
        className="font-semibold underline"
        style={{ color: "var(--color-bt-accent)" }}
      >
        {PLACE}
      </button>
      {message.slice(at + PLACE.length)}
    </>
  );
}
