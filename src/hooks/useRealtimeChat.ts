"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * Subscribes to Supabase Realtime for live chat messages.
 *
 * Channels per REALTIME.md:
 *   - Trip chat: `trip-chat:{tripId}` → messages WHERE trip_id=eq.{tripId} AND channel=eq.trip
 *   - Team chat: `team-chat:{tripId}:{teamId}` → messages WHERE trip_id=eq.{tripId} AND channel=eq.team AND team_id=eq.{teamId}
 *
 * On INSERT events, invalidates the messages query to trigger a refetch.
 * This replaces the previous 3-second polling interval.
 */
export function useRealtimeChat(
  tripId: string,
  channel: "trip" | "team",
  teamId?: string
) {
  const utils = trpc.useUtils();
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (!tripId) return;

    const supabase = supabaseRef.current;

    const invalidate = () => {
      utils.messages.list.invalidate({ tripId, channel, teamId });
    };

    let channelName: string;
    let filter: string;

    if (channel === "trip") {
      channelName = `trip-chat:${tripId}`;
      filter = `trip_id=eq.${tripId}`;
    } else {
      if (!teamId) return;
      channelName = `team-chat:${tripId}:${teamId}`;
      filter = `trip_id=eq.${tripId}`;
    }

    const realtimeChannel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter,
        },
        () => {
          invalidate();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          invalidate();
        }
      });

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [tripId, channel, teamId, utils]);
}
