"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import type { TripRole } from "@/server/middleware";
import { useCurrentUser } from "./useCurrentUser";

export function useTripRole(tripId: string | undefined) {
  const currentUser = useCurrentUser();

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
    canEdit: role === "Owner" || role === "Planner",
    isMember: !!role,
    loading: isLoading,
  };
}
