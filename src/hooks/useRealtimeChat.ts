"use client";

import { useEffect } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * Row shape emitted by the `messages` postgres_changes payload. Matches the
 * exact column set `messages.list` selects, so a payload row can be written
 * straight into the query cache with no enrichment (chat has no server-side
 * joins — unlike events/notifications.list).
 */
interface MessageRow {
  id: string;
  trip_id: string;
  user_id: string | null;
  channel: string;
  team_id: string | null;
  text: string;
  created_at: string;
  visibility: string | null;
  message_type: string | null;
}

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
 * On INSERT, the new row is written directly into the messages cache via
 * setQueryData (prepend) instead of invalidating — the payload carries every
 * column `messages.list` selects, so no refetch round-trip is needed. The
 * panel reads an infinite-query cache (`{ pages }`) and useChatUnreadCount
 * reads a flat-array cache; a single partial-key setQueriesData patches both,
 * branching on shape. Prepends dedup by id, which also covers the sender's own
 * optimistic message (same client-generated id) and any duplicate delivery.
 *
 * The initial SUBSCRIBED tick still invalidates (full refetch) so a (re)connect
 * after a disconnect backfills anything missed while the socket was down.
 */
export function useRealtimeChat(
  tripId: string,
  channel: "trip" | "team",
  teamId?: string
) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();

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

    // Full refetch — used only on (re)subscribe to backfill missed inserts.
    const invalidate = () => {
      utils.messages.list.invalidate({ tripId, channel, teamId });
    };

    // Prepend a freshly-inserted row into every matching messages cache
    // (both the infinite-query pages and the flat-array variants), keyed by
    // the partition the message belongs to. visibility partitions the trip
    // channel; team chat is flat and keyed by teamId instead.
    const prepend = (row: MessageRow) => {
      const partialInput =
        channel === "trip"
          ? {
              tripId,
              channel: "trip" as const,
              visibility:
                (row.visibility as "crew" | "planning" | null) ?? undefined,
            }
          : { tripId, channel: "team" as const, teamId };

      const queryKey = getQueryKey(trpc.messages.list, partialInput, "any");

      queryClient.setQueriesData<MessageRow[] | InfiniteData<MessageRow[]>>(
        { queryKey },
        (old) => {
          if (!old) return old;

          // Infinite-query cache: { pages: Row[][], pageParams }. Page 0 holds
          // the newest rows (server orders created_at DESC), so prepend there.
          if (!Array.isArray(old) && "pages" in old) {
            if (old.pages.some((page) => page.some((m) => m.id === row.id))) {
              return old;
            }
            const pages = old.pages.slice();
            pages[0] = [row, ...(pages[0] ?? [])];
            return { ...old, pages };
          }

          // Flat-array cache (useChatUnreadCount), also created_at DESC.
          if (Array.isArray(old)) {
            if (old.some((m) => m.id === row.id)) return old;
            return [row, ...old];
          }

          return old;
        }
      );
    };

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
        (payload: RealtimePostgresInsertPayload<MessageRow>) => {
          prepend(payload.new);
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
  }, [tripId, channel, teamId, utils, queryClient]);
}
