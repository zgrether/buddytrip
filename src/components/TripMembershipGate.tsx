"use client";

import { useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTripId } from "@/components/TripIdProvider";
import { clearLastTripPointer } from "@/lib/lastTripPointer";
import { isNotAMemberError } from "@/lib/tripAccessMessages";

/**
 * Trips this device just LEFT, through Leave trip. The person leaving knows —
 * they pressed the button — and is already on their way to the dashboard, so
 * the gate must not tell them. Marked BEFORE the leave is sent: the archive
 * commits before its response arrives, and the membership DELETE can reach
 * this client over Realtime first, re-running the roster read in between.
 */
const leftHere = new Set<string>();
export function markLeavingTrip(tripId: string) {
  leftHere.add(tripId);
}
export function unmarkLeavingTrip(tripId: string) {
  leftHere.delete(tripId);
}

/**
 * Should a removed person's open app say so? (PR 8d-3.) Exported for tests.
 *
 *   - `members`: the roster this client LAST READ successfully. React Query
 *     keeps it through a failed refetch, so it still holds the viewer when the
 *     re-read is the one that refuses them — which is exactly what "they were
 *     on this trip while the app was open" means. A cold open of a trip they
 *     were already gone from never had it, and keeps the trip page's quiet
 *     redirect to the dashboard: nothing was taken away while they watched.
 *   - `error`: only the membership gate's real refusal counts
 *     (`isNotAMemberError`). A gate that could not run tells nobody anything.
 */
export function membershipLost({
  userId,
  members,
  error,
  leftHereKnown,
}: {
  userId: string | null | undefined;
  members: { user_id: string | null }[] | undefined;
  error: unknown;
  leftHereKnown: boolean;
}): boolean {
  if (!userId || leftHereKnown) return false;
  const wasMember = !!members?.some((m) => m.user_id === userId);
  return wasMember && isNotAMemberError(error);
}

/**
 * "You're no longer a member of this trip." — the removed person's exit
 * (PR 8d-3; the sentence is the build plan's, ruled 2026-10-08).
 *
 * Without it, a person removed while the app is open met whatever the next
 * read did with a refusal: a refetch error, a dead control, or the trip page's
 * silent bounce to the dashboard. Mounted ONCE, in the trip layout, so every
 * route under a trip — the trip page, the Cup, the standalone game routes —
 * says the same thing.
 *
 * It watches the roster read (`tripMembers.list`) because that is the read the
 * removal itself re-triggers: `useRealtimeMembers` invalidates it on any
 * membership change, and it re-checks on window focus as the dead-socket
 * backstop (see `useTripRole`, which shares the key and the options).
 */
export function TripMembershipGate() {
  const { tripId } = useTripId();
  const currentUser = useCurrentUser();
  const { data: members, error } = trpc.tripMembers.list.useQuery(
    { tripId: tripId! },
    { enabled: !!tripId && !!currentUser, refetchOnWindowFocus: true }
  );

  const lost =
    !!tripId &&
    membershipLost({
      userId: currentUser?.id,
      members,
      error,
      leftHereKnown: leftHere.has(tripId),
    });

  // The root route would otherwise 307 them straight back here.
  useEffect(() => {
    if (lost) clearLastTripPointer();
  }, [lost]);

  if (!lost) return null;
  return <NoLongerAMember />;
}

/** The screen itself. Exported so its markup can be asserted statically. */
export function NoLongerAMember() {
  return (
    <div
      data-testid="no-longer-a-member"
      role="alertdialog"
      aria-labelledby="no-longer-a-member-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "var(--color-bt-base)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 text-center"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <p
          id="no-longer-a-member-title"
          className="text-base font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          You&rsquo;re no longer a member of this trip.
        </p>
        <Link
          href="/dashboard"
          replace
          className="mt-5 inline-flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
        >
          Go to your trips
        </Link>
      </div>
    </div>
  );
}
