"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc-client";
import type { TripRole } from "@/server/middleware";
import { useCurrentUser } from "./useCurrentUser";

export function useTripRole(tripId: string | undefined) {
  const currentUser = useCurrentUser();

  // F8 documented exception — deliberately NOT STRUCTURE_QUERY, unlike most
  // other tripMembers.list observers. This hook resolves Owner/Organizer
  // permissions, so a promotion/demotion has to reach the screen on its own.
  //
  // `useRealtimeMembers` is the primary mechanism: it invalidates THIS key on
  // every trip_members change, and as of #791 it is mounted on the trip page,
  // the competition face, AND all four game views — so the standalone game
  // routes are covered too. (Before #791 they were not, which is what #791
  // fixed.)
  //
  // ── Why `refetchOnWindowFocus` is here anyway ────────────────────────────
  // The global default is `false` (providers.tsx) because Realtime is the
  // freshness source app-wide. This observer opts back IN as the dead-socket
  // backstop — the same redundancy CLAUDE.md #19/#20 insist on for the
  // configHash poll and the leaderboard interval, neither of which has an
  // equivalent here. A subscription that never established, a backgrounded
  // tab that missed the event, a network handoff on a golf course: in all of
  // those the socket is exactly the thing that failed, so it cannot also be
  // the thing that recovers. Returning to the tab re-checks.
  //
  // It is NOT a shortened cache and must not become one. `staleTime` stays at
  // the inherited 60s, and `refetchOnWindowFocus: true` (not `"always"`) is
  // gated on staleness by `shouldFetchOn` — so refocusing within 60s of the
  // last fetch costs nothing, and this can fire at most once a minute per
  // surface. Do NOT lower `staleTime` to make it fire more often; this hook is
  // read on hot paths (trip page, chat, every game view) and that cost lands
  // everywhere to fix a case Realtime already covers.
  //
  // Precedent one level down: `useGameEditAccess` already runs
  // `games.listOrganizers` with `staleTime: 0` + `refetchOnWindowFocus: true`
  // so a REVOKED delegate's affordances drop without a manual refresh. Same
  // reasoning, same shape — this is the trip-role half of it.
  const { data: members, isLoading } = trpc.tripMembers.list.useQuery(
    { tripId: tripId! },
    { enabled: !!tripId && !!currentUser, refetchOnWindowFocus: true }
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
