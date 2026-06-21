"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeCompetition — subscribes to Supabase Realtime for live
 * updates to the trip's competition row (status, scoreboard_style,
 * name, tagline, etc.). Without this, the non-owner's cached
 * competition row stays stale up to the global staleTime (60s) and
 * they'd see the old style or stale Go-Live state.
 *
 * Channel: `competition:{tripId}` — listens to INSERT/UPDATE/DELETE
 * on `competitions` filtered by `trip_id=eq.{tripId}`. On any change,
 * invalidates the `competitions.getByTrip` query so TanStack refetches
 * and re-renders consumers (the competition face / leaderboard, etc.).
 */
export function useRealtimeCompetition(tripId: string | null) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();
    const refresh = () => {
      utils.competitions.getByTrip.invalidate({ tripId });
    };
    const channel = supabase
      .channel(`competition:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competitions",
          filter: `trip_id=eq.${tripId}`,
        },
        refresh
      )
      // Backfill on (re)connect: a dead zone drops the socket, so any change
      // during it would otherwise sit stale up to the 60s staleTime. Refetching
      // on the SUBSCRIBED tick self-heals on reconnect (mirrors useRealtimeChat).
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, utils]);
}
