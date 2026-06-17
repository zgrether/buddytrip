"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeMembers — subscribes to Supabase Realtime for changes to the
 * trip's membership rows (role promotions/demotions, additions, removals).
 *
 * Why this matters: tab visibility and edit permissions resolve from
 * trip_members.role via useTripRole (the tripMembers.list query). Without a
 * live subscription, a member's cached role stays stale up to the query's
 * staleTime — so when the Owner demoted an organizer, that person kept seeing
 * the organizer-only tabs (Lodging / Schedule / Competition) until they
 * happened to refetch or reload. On any trip_members change we invalidate
 * tripMembers.list so every client — including the one whose own role just
 * changed — re-resolves its role and the roster immediately.
 *
 * Channel: `members:{tripId}` — listens to INSERT/UPDATE/DELETE on
 * `trip_members` filtered by `trip_id=eq.{tripId}`. Mirrors
 * useRealtimeCompetition. (trip_members was added to the supabase_realtime
 * publication with REPLICA IDENTITY FULL in migration 017 so DELETEs match
 * the trip_id filter too.)
 */
export function useRealtimeMembers(tripId: string | null) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();
    const refresh = () => {
      utils.tripMembers.list.invalidate({ tripId });
    };
    const channel = supabase
      .channel(`members:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_members",
          filter: `trip_id=eq.${tripId}`,
        },
        refresh
      )
      // Backfill on (re)connect: a role change during a dead zone would
      // otherwise stay stale up to the 60s staleTime. Refetching on the
      // SUBSCRIBED tick self-heals on reconnect (mirrors useRealtimeChat).
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, utils]);
}
