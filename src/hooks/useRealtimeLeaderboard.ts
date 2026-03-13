"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * Subscribes to Supabase Realtime channels for live leaderboard updates.
 *
 * Channels:
 *   - `scores:{eventId}` — listens to INSERT/UPDATE on group_results
 *   - `side-events:{eventId}` — listens to UPDATE on side_events
 *
 * On any event, invalidates the relevant TanStack Query caches so the
 * leaderboard UI refetches automatically.
 */
export function useRealtimeLeaderboard(tripId: string, eventId: string) {
  const utils = trpc.useUtils();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (!eventId) return;

    const supabase = supabaseRef.current;

    const invalidateScores = () => {
      utils.groupResults.listScoresByEvent.invalidate({ tripId, eventId });
      utils.groupResults.list.invalidate();
    };

    const invalidateSideEvents = () => {
      utils.sideEvents.list.invalidate({ tripId, eventId });
    };

    // Channel 1: group_results changes (score submissions)
    const scoresChannel = supabase
      .channel(`scores:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_results",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          invalidateScores();
        }
      )
      .subscribe((status) => {
        // On reconnect, invalidate to catch any missed events
        if (status === "SUBSCRIBED") {
          invalidateScores();
        }
      });

    // Channel 2: side_events changes (side event completions)
    const sideEventsChannel = supabase
      .channel(`side-events:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "side_events",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          invalidateSideEvents();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          invalidateSideEvents();
        }
      });

    return () => {
      supabase.removeChannel(scoresChannel);
      supabase.removeChannel(sideEventsChannel);
    };
  }, [eventId, tripId, utils]);
}
