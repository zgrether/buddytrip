"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeMyDelegations — pushes a "you're running this game now" change to
 * the person it happened to, live.
 *
 * `games.myDelegateGameIds` / `competitions.faceBootstrap` are both
 * `STRUCTURE_QUERY` (staleTime: Infinity, CLAUDE.md's structure/state cut) —
 * correct for slow-changing shape, but that means NOTHING refetches them by
 * time. The Owner assigning a delegate invalidates their OWN client's copies
 * (every game-settings save cascade does — see MatchGameView.tsx et al.), but
 * that's a different browser: the newly-delegated person's leaderboard, if
 * already open, has no way to learn its `game_delegates` row appeared. It sat
 * unmarked until a reload forced a fresh `faceBootstrap` resolve.
 *
 * So this watches `game_delegates` filtered to the CURRENT user's own rows —
 * an INSERT/DELETE there is exactly "my delegation on some game changed" —
 * and invalidates BOTH queries. Both, not just one: `myDelegateGameIds` is
 * what the board actually reads, but `LiveFaceClient` unconditionally
 * re-seeds that same cache from `faceBootstrap` on every remount (pattern
 * #10) — invalidating only the child would be silently undone the next time
 * the face resolves.
 *
 * Filtered to `user_id=eq.{userId}`, not the trip or a game: `game_delegates`
 * carries no `trip_id` column, and scoping to the viewer's own rows is both
 * the narrowest correct filter and the one that matches what this hook is
 * actually answering ("did MY assignment change?").
 *
 * Ref-counted like `useRealtimeMembers`/`useRealtimeChat` (CLAUDE.md #22) —
 * this shell has repeatedly grown a second always-mounted caller of a realtime
 * hook it assumed had exactly one.
 */

type Handler = () => void;

type Entry = {
  channel: RealtimeChannel;
  handlers: Set<Handler>;
  refs: number;
};

const registry = new Map<string, Entry>();

export const myDelegationsTopic = (userId: string) => `my-delegations:${userId}`;

/** Exported for tests — the ref-counting is the part with real failure modes. */
export function acquire(userId: string, handler: Handler): () => void {
  const topic = myDelegationsTopic(userId);
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
        table: "game_delegates",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        for (const h of [...created.handlers]) h();
      }
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Backfill on (re)connect: a grant made during a dead zone never
        // arrived as an event.
        for (const h of [...created.handlers]) h();
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(
          `[realtime] my-delegations channel "${topic}" is not live (status: ${status}). ` +
            `A new delegate grant will not appear on the board until it reconnects.`
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

export function useRealtimeMyDelegations(tripId: string | null | undefined, userId: string | null | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId || !userId) return;
    return acquire(userId, () => {
      utils.games.myDelegateGameIds.invalidate({ tripId });
      utils.competitions.faceBootstrap.invalidate({ tripId });
    });
  }, [tripId, userId, utils]);
}
