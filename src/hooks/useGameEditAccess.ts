"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "./useTripRole";
import { useCurrentUser } from "./useCurrentUser";

/**
 * Client mirror of the server's `canEditGame` admission (middleware): edit access
 * is granted to a trip Owner/Organizer **OR a DELEGATE of THIS game** (a
 * `game_delegates` grant). `useTripRole` only knows the TRIP role, so on its own it
 * is blind to a delegate-who-is-a-plain-Member — this ORs in the per-game delegate
 * grant via `games.listOrganizers`, exactly as the server does (#501 Part 1), so the
 * UI lights up the same way the server admits: Owner/Organizer keep edit on every
 * game; a delegate only on theirs; a plain Member gets neither.
 *
 * The cross-cutting fix — every game surface (golf match/stroke/rack + non-golf,
 * settings + board) reads `canEdit` from HERE, not from `useTripRole` directly, so
 * the gating can't drift per-surface again.
 *
 * `isOwner` stays trip-Owner-only (delegates are NOT owners): the per-game Danger
 * Zone and the delegation grant itself remain owner-gated, matching the server
 * (`requireTripRole("Owner")`).
 */
export function useGameEditAccess(
  tripId: string | undefined,
  gameId: string | null | undefined
) {
  const { canEdit: tripCanEdit, isOwner, loading } = useTripRole(tripId);
  const me = useCurrentUser();
  // This is the ACCESS query — deliberately NOT on STRUCTURE_QUERY's staleTime:
  // Infinity (Spec 1, Task 2). If it were kept forever, a delegate whose grant is
  // REVOKED would keep rendering edit affordances until a hard refresh (their
  // actions already fail server-side — the server re-checks canEditGame live every
  // request — but the stale UI lingers). `staleTime: 0` + an explicit
  // `refetchOnWindowFocus` (the global default is false) re-checks access on the
  // delegate's next mount / tab-refocus, so the affordances drop without a manual
  // refresh. Scoped to THIS observer — the GameIdentityHeader usage keeps its own
  // options. It's a tiny query; refetch-on-focus is negligible.
  const orgQ = trpc.games.listOrganizers.useQuery(
    { tripId: tripId!, gameId: gameId! },
    { enabled: !!tripId && !!gameId, staleTime: 0, refetchOnWindowFocus: true }
  );
  const amDelegate = useMemo(
    () =>
      !!me &&
      ((orgQ.data as { user_id: string }[] | undefined) ?? []).some(
        (o) => o.user_id === me.id
      ),
    [orgQ.data, me]
  );

  return {
    /** Owner/Organizer (any game) OR this game's delegate — mirrors `canEditGame`. */
    canEdit: tripCanEdit || amDelegate,
    /** Trip Owner only — NOT a delegate. Gates the owner-only Danger Zone + grant. */
    isOwner,
    amDelegate,
    loading,
  };
}
