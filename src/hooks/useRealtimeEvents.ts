"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeEvents — subscribes to Supabase Realtime for live updates
 * to the trip's competition events (creates, edits, deletes,
 * reorders, and placement writes via events.result). Without this,
 * non-owner caches stay stale up to the global staleTime (60s) — so
 * they'd see old scores after the owner sets a placement on the event
 * detail page.
 *
 * Filter is by competition_id rather than trip_id since that's the
 * column on the events table.
 *
 * Channel: `events:{competitionId}` — listens to *all* postgres_changes
 * (INSERT/UPDATE/DELETE) and invalidates the events.list query.
 *
 * Mirrors the shape of `useRealtimeNotifications` /
 * `useRealtimeCompetition`.
 */
export function useRealtimeEvents(
  tripId: string | null,
  competitionId: string | null | undefined
) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId || !competitionId) return;

    const supabase = getRealtimeClient();
    const channel = supabase
      .channel(`events:${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `competition_id=eq.${competitionId}`,
        },
        () => {
          utils.events.list.invalidate({ tripId, competitionId });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, competitionId, utils]);
}
