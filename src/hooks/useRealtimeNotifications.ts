"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * Subscribes to Supabase Realtime for live notification updates.
 *
 * Channel: `notifications:{tripId}` — listens to INSERT on notification_events
 * with filter `trip_id=eq.{tripId}`.
 *
 * On event, invalidates the notifications.list query to trigger a refetch.
 * Replaces polling for near-instant notification delivery.
 */
export function useRealtimeNotifications(tripIds: string[]) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (tripIds.length === 0) return;

    const supabase = getRealtimeClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const tripId of tripIds) {
      const ch = supabase
        .channel(`notifications:${tripId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notification_events",
            filter: `trip_id=eq.${tripId}`,
          },
          () => {
            utils.notifications.list.invalidate({ tripId });
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            utils.notifications.list.invalidate({ tripId });
          }
        });

      channels.push(ch);
    }

    return () => {
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [tripIds.join(","), utils]); // eslint-disable-line react-hooks/exhaustive-deps
}
