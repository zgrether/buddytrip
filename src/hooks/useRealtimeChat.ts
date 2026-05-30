"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * Subscribes to Supabase Realtime for live chat messages.
 *
 * Channels per REALTIME.md:
 *   - Trip chat: `trip-chat:{tripId}` → messages filtered by `trip_id=eq.{tripId}`
 *   - Team chat: `team-chat:{tripId}:{teamId}` → messages filtered by `team_id=eq.{teamId}`
 *
 * Supabase Realtime `postgres_changes` only supports a SINGLE column
 * predicate per subscription (no AND/`&` compound filters). So team chat
 * filters on `team_id` alone — team_id is globally unique, so it fully
 * scopes the subscription to that team's messages without also needing
 * trip_id. The previous code filtered the team channel on `trip_id`,
 * which leaked every other team's (and the trip channel's) inserts into
 * the subscription, causing needless refetches.
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

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();

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
      filter = `team_id=eq.${teamId}`;
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
