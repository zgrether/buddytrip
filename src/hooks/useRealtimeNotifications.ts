"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** Raw `notification_events` row as delivered by postgres_changes. */
interface NotificationEventRow {
  id: string;
  type: string;
  trip_id: string;
  actor_id: string | null;
  recipient_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Cached shape of one `notifications.list` item: the selected columns plus the
 * derived `read` flag. A brand-new notification is always unread, so a fresh
 * INSERT maps cleanly to `{ ...selectedColumns, read: false }` with no refetch.
 * (recipient_id is intentionally dropped — list doesn't select it.)
 */
interface CachedNotification {
  id: string;
  type: string;
  trip_id: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  read: boolean;
}

/**
 * Subscribes to Supabase Realtime for live notification updates.
 *
 * Channel: `notifications:{tripId}` — listens to INSERT on notification_events
 * with filter `trip_id=eq.{tripId}`.
 *
 * On INSERT, the new row is written straight into the notifications.list cache
 * via setQueryData (prepend) instead of invalidating — the payload carries
 * every column the query selects, and a new notification is unread by
 * definition. The trip_id filter delivers inserts for ALL recipients on the
 * trip, but list is scoped to the caller server-side, so we prepend only when
 * recipient_id matches the current user (otherwise the row isn't ours and our
 * cache must stay untouched). A partial-key setQueriesData covers every `limit`
 * variant of the query.
 *
 * The SUBSCRIBED tick still invalidates (full refetch) so a (re)connect
 * backfills anything missed while the socket was down.
 */
export function useRealtimeNotifications(tripIds: string[]) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const currentUserId = currentUser?.id ?? null;

  useEffect(() => {
    if (tripIds.length === 0) return;

    const supabase = getRealtimeClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const tripId of tripIds) {
      const prepend = (row: NotificationEventRow) => {
        // Not addressed to us → not in our cache; leave it alone.
        if (!currentUserId || row.recipient_id !== currentUserId) return;

        const queryKey = getQueryKey(
          trpc.notifications.list,
          { tripId },
          "query"
        );

        const next: CachedNotification = {
          id: row.id,
          type: row.type,
          trip_id: row.trip_id,
          actor_id: row.actor_id,
          payload: row.payload,
          created_at: row.created_at,
          read: false,
        };

        queryClient.setQueriesData<CachedNotification[]>(
          { queryKey },
          (old) => {
            if (!old) return old;
            if (old.some((n) => n.id === row.id)) return old;
            return [next, ...old];
          }
        );
      };

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
          (payload: RealtimePostgresInsertPayload<NotificationEventRow>) => {
            prepend(payload.new);
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
  }, [tripIds.join(","), utils, queryClient, currentUserId]); // eslint-disable-line react-hooks/exhaustive-deps
}
