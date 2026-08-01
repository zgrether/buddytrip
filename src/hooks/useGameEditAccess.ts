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
 * `isOwner` stays trip-Owner-only (delegates are NOT owners). It now gates ONE
 * thing — the **delegation grant** (`GameIdentityHeader`'s delegate picker) —
 * because granting someone edit rights on a game is *changing who is trusted*,
 * one level down, which is the Owner's call under the ratified rule.
 *
 * `canManageGame` is the Danger Zone's gate (#789): trip Owner **or Organizer**,
 * delegates excluded. The two split apart because the server split them — #788
 * moved `games.delete` / `.resetScoring` / `.resetToSkeleton` to
 * `requireTripRole("Organizer")` while the delegation grant stayed Owner-only.
 * Before that they shared `isOwner`, and loosening the shared flag would have
 * widened the grant as a silent side effect with no server change to review.
 *
 * NOTE `canManageGame` is NOT a new predicate — it is `useTripRole().canEdit`,
 * which this hook already computed as `tripCanEdit` and threw away. Do not add a
 * second Owner-or-Organizer predicate; there is one.
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
    /** Trip Owner or Organizer, delegates EXCLUDED — gates the per-game Danger
     *  Zone (delete / reset scoring / reset to skeleton), matching their server
     *  gate since #788. A delegate may score and configure a game; deleting it
     *  isn't running it. */
    canManageGame: tripCanEdit,
    /** Trip Owner only — NOT a delegate, NOT an Organizer. Gates the delegation
     *  grant, which stays Owner-only: handing someone edit rights is changing
     *  who is trusted. */
    isOwner,
    amDelegate,
    loading,
  };
}
