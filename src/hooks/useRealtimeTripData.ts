"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeTripData — subscribes to Supabase Realtime for the trip's
 * always-observed LIST tables (Wave 1: cross-device freshness):
 *   - quick_info_tiles  → quickInfoTiles.list  (the header dock)
 *   - logistics_items   → logistics.list       (lodging / check-in-out / itinerary)
 *   - schedule_items    → schedule.list        (agenda / itinerary)
 *
 * Why this matters: these lists are read by the always-mounted trip page (and
 * the never-remounting header dock / itinerary). Their mutations already
 * invalidate the right key, so the ACTING device updates instantly — but the
 * tables were NOT in the realtime publication, so ANOTHER member's screen served
 * cached data up to the global 60s staleTime (refetchOnWindowFocus is off). Wave
 * 1 Phase 0 confirmed the staleness is cross-device; adding realtime closes it.
 *
 * Mirrors useRealtimeMembers / useRealtimeCompetition EXACTLY — one channel per
 * table, filtered by `trip_id=eq.{tripId}`, invalidating the matching list query
 * on any INSERT/UPDATE/DELETE, plus a backfill-invalidate on the SUBSCRIBED tick
 * so a change that landed during a dead zone self-heals on (re)connect. Pure
 * invalidate (no manual cache write): the echo can only arrive AFTER the row
 * commits, so the refetch reads server truth and can't clobber or double-apply
 * the acting device's optimistic update (unlike chat, which prepends by id and
 * so must dedupe — a list refetch replaces wholesale, so there's nothing to
 * dedupe). DELETE propagation relies on REPLICA IDENTITY FULL (migration 077),
 * same as trip_members (mig 017).
 */
export function useRealtimeTripData(tripId: string | null) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();

    // Each table → the list query its rows feed. `refresh` runs on every change
    // AND on the SUBSCRIBED (re)connect tick (reconnect backfill).
    const subs = [
      { table: "quick_info_tiles", refresh: () => utils.quickInfoTiles.list.invalidate({ tripId }) },
      { table: "logistics_items", refresh: () => utils.logistics.list.invalidate({ tripId }) },
      { table: "schedule_items", refresh: () => utils.schedule.list.invalidate({ tripId }) },
    ] as const;

    const channels = subs.map(({ table, refresh }) =>
      supabase
        .channel(`tripdata:${table}:${tripId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `trip_id=eq.${tripId}` },
          refresh
        )
        // Backfill on (re)connect: a change during a dead zone would otherwise
        // sit stale up to the 60s staleTime. Refetching on SUBSCRIBED self-heals
        // (mirrors useRealtimeMembers / useRealtimeChat).
        .subscribe((status) => {
          if (status === "SUBSCRIBED") refresh();
        })
    );

    return () => {
      for (const channel of channels) supabase.removeChannel(channel);
    };
  }, [tripId, utils]);
}
