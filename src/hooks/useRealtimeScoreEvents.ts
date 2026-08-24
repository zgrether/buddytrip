"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";
import { coalesceInvalidation } from "@/lib/invalidationCoalescer";

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
      if (status === "SUBSCRIBED") {
        for (const h of [...created.handlers]) h(null);
        return;
      }
      /**
       * A DEAD SUBSCRIPTION MUST SAY SO — CLAUDE.md #22, which this hook was not
       * following while `useRealtimeChat` and `useRealtimeMembers` both were.
       *
       * Branching only on SUBSCRIBED makes a channel that never establishes
       * indistinguishable from a healthy one with nothing to report: the board
       * renders, looks right, and silently stops updating until the 5-minute
       * backstop. That is the failure mode that cost chat three sessions, and it
       * is the more likely one on a golf course — a backgrounded tab, a network
       * handoff, a dead zone.
       *
       * Found while diagnosing the bracket-pick gap: the local browser could not
       * hold a websocket at all (close code 1006), and chat and members each said
       * so in the console while THIS hook — the one carrying every score and every
       * pick — said nothing.
       *
       * Reporting only, deliberately. No retry and no state change: the client
       * reconnects on its own and the SUBSCRIBED arm above backfills when it does.
       */
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(
          `[realtime] score-event channel "${topic}" is not live (status: ${status}). ` +
            `Scores, bracket picks and lifecycle changes from other devices will not ` +
            `arrive until it reconnects.`,
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
  games: {
    bracketDraw: {
      invalidate: (
        i?: { tripId: string; gameId: string },
        f?: undefined,
        o?: { cancelRefetch: boolean },
      ) => unknown;
    };
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
 *
 * COALESCED. The invalidations are queued through `invalidationCoalescer` rather
 * than fired inline, so a burst costs one refetch per query instead of one per
 * broadcast per handler. The SET of keys is unchanged — this is a timing change,
 * not a scope change, and #10's faceBootstrap pairing still holds. A caller that
 * needs the refetch to have HAPPENED by the time it returns must not rely on
 * this function; it schedules work, it does not await it.
 */
export function makeScoreEventHandler(
  utils: ScoreEventUtils,
  tripId: string,
  competitionId: string,
): Handler {
  return (gameId) => {
    // COALESCED, not fired directly — see `invalidationCoalescer.ts`. Migration
    // 096's `FOR EACH ROW` triggers make one reset emit ~73 broadcasts (measured),
    // and every handler on the channel runs for each one, so the naive version
    // costs broadcasts × handlers × queries refetches for a single tap. That is
    // what took production down. The keys below collapse BOTH multipliers: the
    // handlers on a topic share tripId + competitionId, and a burst carries one
    // gameId, so the whole storm reduces to one refetch per query per window.
    //
    // WHAT IS INVALIDATED IS UNCHANGED — same three keys, same #10 pairing, same
    // invalidate-only posture. Only the timing changed.

    // #10 — faceBootstrap IN ADDITION TO the child query, never instead of.
    // Dropping either leaves a surface stale: the face re-seeds from the
    // bootstrap, while the standalone game routes read the child key directly.
    coalesceInvalidation(`faceBootstrap:${tripId}`, () => {
      void utils.competitions.faceBootstrap.invalidate({ tripId });
    });
    coalesceInvalidation(`leaderboard:${tripId}:${competitionId}`, () => {
      void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    });

    // #15 — hand the score change to the view's EXISTING reconcile rather than
    // applying anything here. On a reconnect backfill (no gameId) we don't know
    // which game moved while we were away, so invalidate the whole key.
    //
    // The two arms get DIFFERENT keys on purpose: the backfill is a strictly
    // broader invalidation, and collapsing it onto a specific game's key would
    // let a per-game event swallow the "everything moved while you were away"
    // refetch that a reconnect depends on.
    if (gameId) {
      coalesceInvalidation(`scores:${tripId}:${gameId}`, () => {
        void utils.scores.listByGame.invalidate({ tripId, gameId });
      });
    } else {
      coalesceInvalidation(`scores:${tripId}:*`, () => {
        void utils.scores.listByGame.invalidate();
      });
    }

    /**
     * THE BRACKET'S SCORE. A pick is a result exactly as a hole score is, and it
     * broadcasts on the same topic — migration 118's `bracket_matches_pick_broadcast`
     * fires on `winner_entrant_id` changing — but this handler's key list did not
     * carry the query that holds it, so the event arrived and refreshed nothing a
     * bracket renders.
     *
     * The draw is `STRUCTURE_QUERY` (`staleTime: Infinity`), so nothing else was
     * going to catch it either: no poll, and `games.configHash` deliberately
     * EXCLUDES `winner_entrant_id` (CLAUDE.md #16 — a result must never churn the
     * config hash), so the ~20s config sync is silent on picks by design. The only
     * invalidators were the picking client's own mutation and finalize. That is
     * CLAUDE.md #22's "two lists that happen to match", except they did not: your
     * own picks appeared and everyone else's never did, until a hard reload.
     *
     * `cancelRefetch: false` for the same measured reason `BracketScoringSurface`
     * uses it — a second invalidation during an in-flight refetch otherwise cancels
     * it and the first response never reaches the cache
     * (`src/lib/invalidateCancelsRefetch.test.ts`). A remote burst is precisely when
     * that overlaps a local pick's refetch.
     *
     * Invalidate-only, like everything above: the payload is a SIGNAL (#20), and the
     * refetch is what re-applies auth. Nothing here reads the event's contents.
     */
    if (gameId) {
      coalesceInvalidation(`bracketDraw:${tripId}:${gameId}`, () => {
        void utils.games.bracketDraw.invalidate({ tripId, gameId }, undefined, {
          cancelRefetch: false,
        });
      });
    } else {
      coalesceInvalidation(`bracketDraw:${tripId}:*`, () => {
        void utils.games.bracketDraw.invalidate(undefined, undefined, {
          cancelRefetch: false,
        });
      });
    }
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
