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
 * and re-renders consumers (the competition face / leaderboard, etc.).
 *
 * It ALSO invalidates competitions.faceBootstrap — the Live face's kept
 * STRUCTURE snapshot (the board reads competition status/name from
 * boot.competition). faceBootstrap is now staleTime: Infinity (STRUCTURE_QUERY)
 * and warm soft-nav no longer re-resolves it server-side (Router Cache), so a
 * watching member's go-live reveal can no longer ride the old 60s staleTime /
 * soft-nav re-run — it must come from this invalidation (pattern #10: invalidate
 * the bootstrap, not only the child).
 */
export function useRealtimeCompetition(tripId: string | null) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId) return;

    const supabase = getRealtimeClient();
    // On an ACTUAL competition change (go-live, name, tagline), invalidate BOTH
    // getByTrip AND the Live face's kept structure snapshot (faceBootstrap) — the
    // board reads competition status from boot.competition, and faceBootstrap is
    // now staleTime: Infinity, so a watching member's go-live reveal must come
    // from this invalidation (pattern #10).
    const onChange = () => {
      utils.competitions.getByTrip.invalidate({ tripId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
    };
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
        onChange
      )
      // Backfill on (re)connect: a dead zone drops the socket, so any change
      // during it would otherwise sit stale up to the 60s staleTime. Refetching
      // on the SUBSCRIBED tick self-heals on reconnect (mirrors useRealtimeChat).
      // NOTE: this fires on EVERY mount, not just reconnect — so it deliberately
      // does NOT touch faceBootstrap. faceBootstrap is the kept STRUCTURE layer
      // (load once, keep); re-invalidating it here would re-resolve the whole
      // structure on every trip→live, the exact tap-around refetch the cut
      // removes. getByTrip is cheap and stays on the per-mount heal.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") utils.competitions.getByTrip.invalidate({ tripId });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, utils]);
}
