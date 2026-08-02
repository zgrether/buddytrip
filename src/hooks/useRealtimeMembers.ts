"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeMembers — subscribes to Supabase Realtime for changes to the
 * trip's membership rows (role promotions/demotions, additions, removals).
 *
 * Why this matters: tab visibility and edit permissions resolve from
 * trip_members.role via useTripRole (the tripMembers.list query). Without a
 * live subscription, a member's cached role stays stale — so when the Owner
 * demoted an organizer, that person kept seeing the organizer-only tabs
 * (Lodging / Schedule / Competition) until they happened to refetch or reload.
 * On any trip_members change we invalidate tripMembers.list so every client —
 * including the one whose own role just changed — re-resolves its role and the
 * roster immediately.
 *
 * Channel: `members:{tripId}` — listens to INSERT/UPDATE/DELETE on
 * `trip_members` filtered by `trip_id=eq.{tripId}`. (trip_members was added to
 * the supabase_realtime publication with REPLICA IDENTITY FULL in migration 017
 * so DELETEs match the trip_id filter too.)
 *
 * ── Ref-counted, and it had to become so (#791) ──────────────────────────────
 * This hook is mounted by MORE THAN ONE live component at a time, and it was
 * not built for that. On every trip page BOTH the page itself (`page.tsx`) and
 * the competition face (`LiveFaceClient`, kept mounted by `AppShell` as the
 * `cup` surface) call it with the same tripId, so both asked for the topic
 * `members:{tripId}`. Read from supabase-js, that was never two independent
 * subscriptions:
 *
 *   - `RealtimeClient.channel(topic)` RETURNS THE EXISTING channel when one
 *     already carries that topic — the two callers shared one object.
 *   - `RealtimeChannel.subscribe()` gates its whole join on `state == closed`,
 *     so the second caller's `subscribe()` was a no-op: its `postgres_changes`
 *     binding never entered the join payload and its status callback was never
 *     wired.
 *   - `removeChannel(channel)` calls `unsubscribe()` on that SHARED object, so
 *     whichever consumer unmounted first killed the stream for the one still on
 *     screen — silently.
 *
 * That is CLAUDE.md #22 exactly, and this is the fix it prescribes: a
 * module-level registry keyed by topic, one channel per topic, torn down only
 * on the LAST release. Same mechanism as `useRealtimeChat` /
 * `useRealtimeScoreEvents`. Duplicate subscribers are now CORRECT rather than
 * forbidden — which is the point, because #791 adds four more (the standalone
 * game routes), and the next shell restructure will move who-is-mounted again.
 */

type Handler = () => void;

type Entry = {
  channel: RealtimeChannel;
  handlers: Set<Handler>;
  refs: number;
};

/** topic → the one channel serving it, and everyone listening to it. */
const registry = new Map<string, Entry>();

/** Topic for a trip's membership stream. One channel per trip. */
export const membersTopic = (tripId: string) => `members:${tripId}`;

/**
 * Join a trip's membership topic (creating the channel if this is the first
 * caller) and return a release fn.
 *
 * EXPORTED for tests: the ref-counting is the part with real failure modes — a
 * premature teardown silently kills permission updates for a surface that is
 * still mounted — and the suite runs in `environment: "node"`, so there is no
 * renderer to exercise it through the hook.
 */
export function acquire(tripId: string, handler: Handler): () => void {
  const topic = membersTopic(tripId);
  let entry = registry.get(topic);

  if (!entry) {
    const supabase = getRealtimeClient();
    const channel = supabase.channel(topic);
    const created: Entry = { channel, handlers: new Set(), refs: 0 };

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "trip_members",
        filter: `trip_id=eq.${tripId}`,
      },
      () => {
        for (const h of [...created.handlers]) h();
      }
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Backfill on (re)connect: a role change during a dead zone never
        // arrived as an event, so refetch on the SUBSCRIBED tick rather than
        // trusting the event path alone.
        for (const h of [...created.handlers]) h();
        return;
      }
      // FAIL LOUD (#22). A subscription that never establishes is
      // indistinguishable from a working one with nothing to report — which is
      // precisely how a permissions gap presents as "sometimes slow" rather
      // than "broken". Nothing here can repair the socket, but silence about it
      // is what makes this expensive to find.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(
          `[realtime] members channel "${topic}" is not live (status: ${status}). ` +
            `Role and roster changes will not arrive until it reconnects.`
        );
      }
    });

    entry = created;
    registry.set(topic, created);
  }

  entry.handlers.add(handler);
  entry.refs += 1;

  let released = false;
  return () => {
    // Effect cleanup can run twice (StrictMode, fast refresh); never let that
    // double-decrement and tear down a channel another surface still needs.
    if (released) return;
    released = true;

    const current = registry.get(topic);
    if (!current) return;
    current.handlers.delete(handler);
    current.refs -= 1;
    if (current.refs <= 0) {
      registry.delete(topic);
      getRealtimeClient().removeChannel(current.channel);
    }
  };
}

/**
 * Safe to call from as many mounted components as you like — the channel is
 * ref-counted per topic (see `acquire`), so N subscribers share ONE join and
 * teardown waits for the last of them.
 */
export function useRealtimeMembers(tripId: string | null | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId) return;
    return acquire(tripId, () => {
      utils.tripMembers.list.invalidate({ tripId });
    });
  }, [tripId, utils]);
}
