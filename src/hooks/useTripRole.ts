"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import type { TripRole } from "@/server/middleware";
import { useCurrentUser } from "./useCurrentUser";

export function useTripRole(tripId: string | undefined) {
  const currentUser = useCurrentUser();

  // F8 documented exception — deliberately NOT STRUCTURE_QUERY, unlike most
  // other tripMembers.list observers. This hook is reachable from the
  // standalone game routes (via useGameEditAccess/useCanEditTeam, called from
  // MatchGameView/RackGameView/StrokeGameView/NonGolfGameView) as well as the
  // trip page and competition face. useRealtimeMembers — the subscription
  // that makes staleTime: Infinity safe elsewhere by invalidating this exact
  // key on every trip_members change — is only mounted on the trip page
  // (page.tsx) and the competition face (LiveFaceClient.tsx), NOT on those
  // standalone routes. This hook resolves Owner/Organizer permissions, so a
  // demotion/promotion must still surface within the existing 60s staleTime
  // window there, not freeze until an unrelated remount.
  const { data: members, isLoading } = trpc.tripMembers.list.useQuery(
    { tripId: tripId! },
    { enabled: !!tripId && !!currentUser }
  );

  const role = useMemo(() => {
    if (!members || !currentUser) return null;
    const me = members.find((m) => m.user_id === currentUser.id);
    return (me?.role ?? null) as TripRole | null;
  }, [members, currentUser]);

  return {
    role,
    isOwner: role === "Owner",
    canEdit: role === "Owner" || role === "Organizer",
    isMember: !!role,
    loading: isLoading,
  };
}
