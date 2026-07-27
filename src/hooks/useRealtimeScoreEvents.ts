"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

/**
 * useRealtimeScoreEvents — pushes SCORE and game-lifecycle changes to every open
 * competition surface live, so the board no longer has to poll to find out.
 *
 * This replaces the 30s `competitions.leaderboard` poll as the PRIMARY freshness
 * mechanism (the poll stays, lengthened, purely as a dead-socket backstop).
 *
 * ── Not to be confused with `useRealtimeCompetition` ─────────────────────────
 * That hook watches the competition ROW (name, tagline, status/go-live) via
 * `postgres_changes` on topic `competition:{tripId}` — keyed by TRIP. This one
 * watches score + lifecycle EVENTS via broadcast on
 * `competition_events:{competitionId}` — keyed by COMPETITION. Different key
 * space, different mechanism, deliberately different topic prefix so the two
 * can never collide. They compose; a competition surface mounts both.
 *
 * ── Broadcast, not postgres_changes ──────────────────────────────────────────
 * Migration 084 deliberately kept the score tables OUT of the Realtime
 * publication, and that still holds. Broadcast needs no publication, and it lets
 * the DATABASE choose what subscribers are told instead of shipping whole rows
 * over WAL. Migration 096 owns the emitting trigger.
 *
 * ── The payload is a SIGNAL, never data ──────────────────────────────────────
 * The trigger sends `{gameId, competitionId}` and nothing else, on a PUBLIC
 * topic. We deliberately do not read a score out of the event and write it into
 * the cache, and no future change should either:
 *
 *   1. Security — the topic is not access-controlled. Refetching through tRPC is
 *      what re-applies auth + RLS, so each viewer still sees only what they may.
 *   2. CLAUDE.md #15 — the active enterer's in-flight cells (saving / error /
 *      in-outbox) WIN over any remote update. Applying a payload value directly
 *      would clobber the cell someone is mid-entry on. Invalidating instead
 *      routes the change back through `scores.listByGame` → the view's existing
 *      `reconcileScores(..., protectedKeys)` effect, which already protects
 *      those cells. Alternate trigger, same reconcile — no second overlay path.
 *
 * Both properties come from the same decision, and both break together the
 * moment data rides along in the payload.
 *
 * ── What gets invalidated, and why faceBootstrap is not optional ─────────────
 * CLAUDE.md #10: the Live face seeds its child caches from
 * `competitions.faceBootstrap` via `setData` on mount. Invalidating
 * `competitions.leaderboard` ALONE is silently undone — the re-seed writes the
 * bootstrap's stale value back AND marks the query fresh, so no refetch fires.
 * Both, always. (This matters more now, not less: with the poll lengthened to a
 * backstop interval, a missed invalidation is stale for minutes, not seconds.)
 *
 * ── Subscribe on VIEW, not on membership ─────────────────────────────────────
 * The channel opens when a competition surface mounts and closes when it
 * unmounts. Nobody holds a socket for a competition they aren't looking at.
 *
 * ── Why the ref-counted registry ─────────────────────────────────────────────
 * Under the panel model (CLAUDE.md #12) the board stays MOUNTED beneath an open
 * game panel, so `CompetitionLeaderboard` and `GamePageHeader` can both be live
 * on the same competition at once. Two `supabase.channel(sameTopic)` objects
 * means two joins for one stream of events and — worse — the first unmount would
 * `removeChannel` a topic the other still needs, silently killing live updates
 * for the surface left behind. So topics are shared and ref-counted here: one
 * channel per topic per client, torn down only on the LAST release.
 */

type Handler = (gameId: string | null) => void;

type Entry = {
  channel: RealtimeChannel;
  handlers: Set<Handler>;
  refs: number;
};

/** topic → the one channel serving it, and everyone listening to it. */
const registry = new Map<string, Entry>();

/** The event name migration 096's trigger sends. */
export const SCORE_EVENT = "score_changed";

/** Topic for a competition's score/lifecycle events. Distinct from
 *  `competition:{tripId}` (useRealtimeCompetition) on purpose. */
export const scoreEventsTopic = (competitionId: string) => `competition_events:${competitionId}`;

/**
 * Join `topic` (creating the channel if this is the first caller) and return a
 * release fn. EXPORTED for tests: the ref-counting is the part with real failure
 * modes — a premature teardown silently kills live updates for a surface that is
 * still mounted — and the suite runs in `environment: "node"`, so there is no
 * renderer to exercise it through the hook.
 */
export function acquire(topic: string, handler: Handler): () => void {
  let entry = registry.get(topic);

  if (!entry) {
    const supabase = getRealtimeClient();
    const channel = supabase.channel(topic);
    const created: Entry = { channel, handlers: new Set(), refs: 0 };

    channel.on("broadcast", { event: SCORE_EVENT }, (message) => {
      // The trigger sends {gameId, competitionId}; realtime.send adds its own
      // opaque message `id`. Nothing else is read from the payload, on purpose.
      const gameId = (message?.payload as { gameId?: string } | undefined)?.gameId ?? null;
      for (const h of [...created.handlers]) h(gameId);
    });

    // Backfill on (re)connect. A score entered while this client was in a dead
    // zone would otherwise stay invisible until the backstop refetch — the same
    // self-heal useRealtimeGame does on its SUBSCRIBED tick.
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") for (const h of [...created.handlers]) h(null);
    });

    entry = created;
    registry.set(topic, created);
  }

  entry.handlers.add(handler);
  entry.refs += 1;

  let released = false;
  return () => {
    // Effect cleanup can run twice (StrictMode, fast refresh); never let that
    // double-decrement and tear down a channel another surface is still using.
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

/** The invalidation surface this hook is allowed to touch. Narrow on purpose —
 *  see `makeScoreEventHandler`. */
type ScoreEventUtils = {
  competitions: {
    faceBootstrap: { invalidate: (i: { tripId: string }) => unknown };
    leaderboard: { invalidate: (i: { tripId: string; competitionId: string }) => unknown };
  };
  scores: {
    listByGame: { invalidate: (i?: { tripId: string; gameId: string }) => unknown };
  };
};

/**
 * What a broadcast does to the cache. Extracted from the hook so the contract is
 * testable without a renderer — the rules below are the whole safety argument
 * for this feature, and "I read the code and it looked right" is not a guard.
 *
 * INVALIDATE ONLY. There is deliberately no `setData` here, and adding one would
 * break CLAUDE.md #15: the view's reconcile (`useScoreSaver.reconcile` →
 * `reconcileScores(local, server, protectedKeys)`) is what protects the active
 * enterer's in-flight cells, and it only runs on refetched server data. Writing
 * the cache directly would bypass it and clobber the cell someone is typing in.
 */
export function makeScoreEventHandler(
  utils: ScoreEventUtils,
  tripId: string,
  competitionId: string,
): Handler {
  return (gameId) => {
    // #10 — faceBootstrap IN ADDITION TO the child query, never instead of.
    // Dropping either leaves a surface stale: the face re-seeds from the
    // bootstrap, while the standalone game routes read the child key directly.
    void utils.competitions.faceBootstrap.invalidate({ tripId });
    void utils.competitions.leaderboard.invalidate({ tripId, competitionId });

    // #15 — hand the score change to the view's EXISTING reconcile rather than
    // applying anything here. On a reconnect backfill (no gameId) we don't know
    // which game moved while we were away, so invalidate the whole key.
    if (gameId) void utils.scores.listByGame.invalidate({ tripId, gameId });
    else void utils.scores.listByGame.invalidate();
  };
}

export function useRealtimeScoreEvents(
  tripId: string | undefined,
  competitionId: string | null | undefined,
) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId || !competitionId) return;
    const handler = makeScoreEventHandler(
      utils as unknown as ScoreEventUtils,
      tripId,
      competitionId,
    );
    return acquire(scoreEventsTopic(competitionId), handler);
  }, [tripId, competitionId, utils]);
}
