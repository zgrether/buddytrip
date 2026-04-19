"use client";

import { trpc } from "@/lib/trpc-client";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";

/**
 * Aggregates notifications across all of the viewer's trips into a single
 * feed suitable for the global `<TopNav />` bell. Handles:
 *
 *  - Fetching the viewer's trip list, then each trip's notification feed
 *    (via `trpc.useQueries` over a stable-length array).
 *  - Realtime subscription so the bell updates live.
 *  - A single `markAllRead` handler that fan-outs to every trip with
 *    unread items.
 *
 * Use this on app-level pages (dashboard, profile, new-trip, archived
 * ideas) where we want the bell wired without duplicating the
 * aggregation logic.
 */

export interface GlobalNotification {
  id: string;
  type: string;
  trip_id: string;
  created_at: string;
  read: boolean;
  payload?: Record<string, unknown>;
}

export interface UseGlobalNotificationsResult {
  notifications: GlobalNotification[];
  unreadCount: number;
  markAllRead: () => void;
}

export function useGlobalNotifications(): UseGlobalNotificationsResult {
  const utils = trpc.useUtils();

  const { data: trips = [], isLoading: tripsLoading } =
    trpc.trips.list.useQuery();
  const tripIds = trips.map((t) => t.id);

  // Stable-length array: pass [] while trips load so `trpc.useQueries`
  // doesn't violate Rules of Hooks when the id list grows.
  const stableTripIds = tripsLoading ? [] : tripIds;

  useRealtimeNotifications(stableTripIds);

  const notifResults = trpc.useQueries((t) =>
    stableTripIds.map((id) => t.notifications.list({ tripId: id, limit: 20 }))
  );

  const notifications: GlobalNotification[] = notifResults
    .flatMap((r) => r.data ?? [])
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const unreadByTrip = new Map<string, number>();
  for (const n of notifications) {
    if (!n.read) {
      unreadByTrip.set(n.trip_id, (unreadByTrip.get(n.trip_id) ?? 0) + 1);
    }
  }
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      for (const id of tripIds) {
        utils.notifications.list.invalidate({ tripId: id });
      }
    },
  });

  const markAllRead = () => {
    for (const id of tripIds) {
      if ((unreadByTrip.get(id) ?? 0) > 0) {
        markAllReadMutation.mutate({ tripId: id });
      }
    }
  };

  return { notifications, unreadCount, markAllRead };
}
