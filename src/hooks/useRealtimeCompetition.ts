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
 * and re-renders consumers (ScoreboardPanel, CompTab, etc.).
 *
 * Mirrors the shape of `useRealtimeNotifications`.
 */
export function useRealtimeCompetition(tripId: string | null) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();
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
        () => {
          utils.competitions.getByTrip.invalidate({ tripId });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, utils]);
}
