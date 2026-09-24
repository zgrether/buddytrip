"use client";

import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";
import { coalesceInvalidation } from "@/lib/invalidationCoalescer";
import { BROADCAST_TABLES, type BroadcastTable } from "@/lib/broadcastTables";

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

/**
 * What KIND of change a broadcast reports (migration 189, #1284): `"game"` when a
 * `games` row moved (go-live, finalize, correction, reorder, insert, delete),
 * `"score"` for every result table. NULL when unknown — an event from before
 * 189, a value this client does not recognise, or a reconnect backfill — and
 * every consumer must treat null as "anything could have changed".
 */
export type ScoreEventKind = "score" | "game";

/** Strict on purpose: only the two literals 189 can send are believed. */
export function parseScoreEventKind(payload: unknown): ScoreEventKind | null {
  const kind = (payload as { kind?: unknown } | null | undefined)?.kind;
  return kind === "score" || kind === "game" ? kind : null;
}

type Handler = (gameId: string | null, kind: ScoreEventKind | null) => void;

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
      const kind = parseScoreEventKind(message?.payload);
      for (const h of [...created.handlers]) h(gameId, kind);
    });

    // Backfill on (re)connect. A score entered while this client was in a dead
    // zone would otherwise stay invisible until the backstop refetch — the same
    // self-heal useRealtimeGame does on its SUBSCRIBED tick.
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        for (const h of [...created.handlers]) h(null, null);
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
/** A game-scoped list query: invalidated for one game, or for all on a backfill. */
type GameScopedQuery = {
  invalidate: (
    i?: { tripId: string; gameId: string },
    f?: undefined,
    o?: { cancelRefetch: boolean },
  ) => unknown;
};

type ScoreEventUtils = {
  competitions: {
    faceBootstrap: { invalidate: (i: { tripId: string }) => unknown };
    leaderboard: { invalidate: (i: { tripId: string; competitionId: string }) => unknown };
  };
  scores: { listByGame: GameScopedQuery };
  games: { bracketDraw: GameScopedQuery };
  matches: { listByGame: GameScopedQuery };
  matchOutcomes: { listByGame: GameScopedQuery };
  skinsOutcomes: { listByGame: GameScopedQuery };
  pickem: { get: GameScopedQuery };
};

/** A query the handler knows how to refresh. */
type Reader =
  | "faceBootstrap"
  | "leaderboard"
  | "scores"
  | "matchOutcomes"
  | "skinsOutcomes"
  | "pickem"
  | "bracketDraw"
  | "matches";

/**
 * WHICH QUERY RENDERS EACH BROADCASTING TABLE — the one list (#1432).
 *
 * This replaced a hand-kept block per query that was patched one key at a time
 * after someone noticed a stale screen: bracket picks ("the event arrived and
 * refreshed nothing a bracket renders"), then non-golf Matches results. Three
 * were still missing when production measured it — a hole entered on one device
 * reached another only on its poll (7.2s on one sample, uniform 0–20s by
 * construction), because the broadcast arrived in ~1.5s and refreshed
 * everything except the query the match card reads:
 *
 *   match_hole_outcomes → matchOutcomes.listByGame  (outcome-mode match play;
 *                         all four BBMI 2026 rounds — 342 rows, 0 score_entries)
 *   skins_hole_outcomes → skinsOutcomes.listByGame  (its trigger: migration 192)
 *   pickem_slate_games  → pickem.get                (a runner's result; 60s poll)
 *
 * `Record<BroadcastTable, …>` so `tsc` refuses a broadcasting table with no
 * reader, and `broadcastRegistry.schema.test.ts` holds `BROADCAST_TABLES` equal to
 * the triggers that actually exist in the migrated schema. So the list cannot
 * silently fall behind the database again.
 *
 * #10 — faceBootstrap is refreshed alongside the leaderboard, never instead of
 * it: the face re-seeds the child from the bootstrap, while standalone routes
 * read the child key directly. It hangs off `games` alone, which is what #1284's
 * rule says (next comment).
 */
export const BROADCAST_READERS: Record<BroadcastTable, readonly Reader[]> = {
  games: ["faceBootstrap", "leaderboard"],
  game_results: ["leaderboard"],
  score_entries: ["scores"],
  match_hole_outcomes: ["matchOutcomes"],
  skins_hole_outcomes: ["skinsOutcomes"],
  game_matches: ["matches"],
  bracket_matches: ["bracketDraw"],
  pickem_slate_games: ["pickem"],
};

/**
 * The payload carries no table (#1284 kept it to two words, deliberately), so an
 * event is routed by its KIND, which the SQL derives from the trigger's own
 * table: `CASE WHEN TG_TABLE_NAME = 'games' THEN 'game' ELSE 'score' END`
 * (pinned by the contract test). A SCORE event therefore came from some table
 * other than `games`, and refreshes the readers of all of those; a GAME event, or
 * an unknown kind (pre-189, or a reconnect backfill), refreshes everything.
 *
 * Refreshing the union costs nothing for a query nobody has mounted — only active
 * observers refetch, and on a game page those are scoped to that game.
 *
 * #1284 falls out of this rather than being a special case: faceBootstrap is a
 * reader of `games` only, so a score event — which cannot have changed the
 * competition, roles, teams or games rows it holds — never refetches it.
 */
const SCORE_TABLES = BROADCAST_TABLES.filter((t) => t !== "games");

function readersFor(kind: ScoreEventKind | null): Set<Reader> {
  const tables = kind === "score" ? SCORE_TABLES : BROADCAST_TABLES;
  const out = new Set<Reader>();
  for (const t of tables) for (const r of BROADCAST_READERS[t]) out.add(r);
  return out;
}

/**
 * A game-scoped refresh: for the game in the event, or — on a reconnect backfill
 * (no gameId) — for every game, because we cannot know which moved while we were
 * away. The two arms get DIFFERENT coalescing keys on purpose: the backfill is a
 * strictly broader invalidation, and collapsing it onto one game's key would let
 * a per-game event swallow the "everything moved" refetch a reconnect relies on.
 *
 * `keepInFlight` passes `cancelRefetch: false`: a second invalidation during an
 * in-flight refetch otherwise cancels it and the first response never reaches
 * the cache (`src/lib/invalidateCancelsRefetch.test.ts`). A remote burst is
 * precisely when that overlaps a local tap's own refetch. `scores` keeps the
 * default, as it always has.
 */
function gameScoped(
  prefix: string,
  pick: (u: ScoreEventUtils) => GameScopedQuery,
  keepInFlight: boolean,
) {
  return (utils: ScoreEventUtils, tripId: string, gameId: string | null) => {
    const opts = keepInFlight ? { cancelRefetch: false } : undefined;
    if (gameId) {
      coalesceInvalidation(`${prefix}:${tripId}:${gameId}`, () => {
        void pick(utils).invalidate({ tripId, gameId }, undefined, opts);
      });
    } else {
      coalesceInvalidation(`${prefix}:${tripId}:*`, () => {
        void pick(utils).invalidate(undefined, undefined, opts);
      });
    }
  };
}

/**
 * How each reader is refreshed. The coalescing keys are the ones the handler has
 * always used, so a burst still collapses to one refetch per query per window.
 */
const INVALIDATE: Record<
  Reader,
  (utils: ScoreEventUtils, tripId: string, gameId: string | null, competitionId: string) => void
> = {
  faceBootstrap: (utils, tripId) =>
    coalesceInvalidation(`faceBootstrap:${tripId}`, () => {
      void utils.competitions.faceBootstrap.invalidate({ tripId });
    }),
  leaderboard: (utils, tripId, _gameId, competitionId) =>
    coalesceInvalidation(`leaderboard:${tripId}:${competitionId}`, () => {
      void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
    }),
  scores: gameScoped("scores", (u) => u.scores.listByGame, false),
  matchOutcomes: gameScoped("matchOutcomes", (u) => u.matchOutcomes.listByGame, true),
  skinsOutcomes: gameScoped("skinsOutcomes", (u) => u.skinsOutcomes.listByGame, true),
  pickem: gameScoped("pickem", (u) => u.pickem.get, true),
  bracketDraw: gameScoped("bracketDraw", (u) => u.games.bracketDraw, true),
  matches: gameScoped("matchesListByGame", (u) => u.matches.listByGame, true),
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
  // COALESCED, not fired directly — see `invalidationCoalescer.ts`. Migration
  // 096's `FOR EACH ROW` triggers make one reset emit ~73 broadcasts (measured),
  // and every handler on the channel runs for each one, so the naive version
  // costs broadcasts × handlers × queries refetches for a single tap. That is
  // what took production down. The coalescing keys collapse both multipliers.
  //
  // #15 — INVALIDATE ONLY: the refetch hands the change to each view's existing
  // reconcile (`reconcileScores` / outcome mode's local-over-server overlay),
  // which is what protects the active enterer's in-flight cells. Nothing here
  // reads the event's contents beyond the game id and kind.
  return (gameId, kind) => {
    for (const reader of readersFor(kind)) {
      INVALIDATE[reader](utils, tripId, gameId, competitionId);
    }
  };
}

/**
 * COMPILE-TIME: every path the handler invokes exists on the REAL router's
 * utils. The hook below hands them over `as unknown as ScoreEventUtils` (tRPC's
 * signatures are wider than the handler needs), and that cast means a mistyped
 * or renamed path would pass `tsc` and throw inside the coalescer's timer at
 * runtime — silently stopping every refresh after it. Naming each path here makes
 * `tsc` refuse one that does not exist. Add a line when a `Reader` is added.
 */
type _Utils = ReturnType<typeof trpc.useUtils>;
type _ReaderPathsExist = [
  _Utils["competitions"]["faceBootstrap"]["invalidate"],
  _Utils["competitions"]["leaderboard"]["invalidate"],
  _Utils["scores"]["listByGame"]["invalidate"],
  _Utils["games"]["bracketDraw"]["invalidate"],
  _Utils["matches"]["listByGame"]["invalidate"],
  _Utils["matchOutcomes"]["listByGame"]["invalidate"],
  _Utils["skinsOutcomes"]["listByGame"]["invalidate"],
  _Utils["pickem"]["get"]["invalidate"],
];

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
