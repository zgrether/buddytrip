"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";
import { coalesceInvalidation } from "@/lib/invalidationCoalescer";

/**
 * useRealtimeGame — pushes a game's CONFIG changes to every viewer live (mirrors
 * useRealtimeMembers). The instant half of cross-device game-state reconcile;
 * useConfigSync's ~20s hash poll stays as the reconnect/dead-zone backstop.
 *
 * Subscribes to the five tables readGameConfigHash fans out over — `games` (name /
 * status / course / modifiers / points / entry_mode / scoring_enabled),
 * `game_matches` (matchups), `game_participants` + `play_groups` (rosters /
 * handicaps), and `game_delegates` — PLUS pick'em's two, which are not in any
 * config hash. On any of them, PURE INVALIDATE the game's read queries (no setData).
 *
 * ── The two pick'em tables, and why the "no score tables" rule does not reach
 *    `pickem_slate_games` ────────────────────────────────────────────────────
 *
 * Golf's score tables stay OUT because scores have an outbox and a poll, and the
 * active enterer's in-flight cells must WIN over any remote update (#15). A
 * realtime overwrite there would clobber exactly what that contract protects.
 *
 * Pick'em has neither. A result is one runner tapping one button through one
 * RPC — no outbox, no per-cell optimism, nothing local for a refetch to
 * clobber. The rule protects a mechanism pick'em does not have, so it does not
 * apply, and the results table is watched like any other.
 *
 * ── This header used to claim `pickem_games` was here, and it was not ───────
 *
 * Migration 151 published the table; the subscription never landed. So from
 * #1098 until migration 160, pick'em's clock reached other devices on the 60s
 * poll ALONE — a runner locking picks and sixteen phones not noticing for a
 * minute. The comment asserted it, the code did not do it, and
 * `useRealtimeGame.test.ts` pinned the five-table set, so the test was
 * defending the defect rather than the intent. Second time this month a test
 * has been found doing that (the other: `games.saveConfig.test.ts` requiring
 * the delegates key to be silently dropped, migration 158).
 *
 * Composes with `draftTouched` (draft-then-save): the invalidate refetches
 * getById/configHash, but the settings page's slices only re-seed from the server
 * while the draft is UNTOUCHED. A clean page converges live; a DIRTY page holds the
 * user's edits (the seed effect no-ops under the touched lock, and the baseline +
 * baseHash are frozen) and gets its honest CONFLICT at Save when the server moved
 * underneath it. That's the whole point of the frozen baseHash — realtime just makes
 * the divergence visible sooner.
 *
 * Channel `game:{gameId}`. game_matches / game_participants / play_groups carry
 * REPLICA IDENTITY FULL (migration 084) so their game_id-filtered DELETEs — a
 * clean-replace, a removed last match, a dropped handicap — reach subscribers.
 */
/**
 * The tables this hook watches, and the column each is filtered by:
 * readGameConfigHash's fan-out PLUS pick'em's clock and results, which are in no
 * config hash. The game row filters by its PK (`id`); every child table by
 * `game_id`. Exported so a test can lock the set + the filter columns without a
 * DOM renderer (the real risk is a wrong table or an `id`↔`game_id` slip).
 */
export const GAME_REALTIME_SUBSCRIPTIONS = [
  { table: "games", column: "id" },
  { table: "game_matches", column: "game_id" },
  { table: "game_participants", column: "game_id" },
  { table: "play_groups", column: "game_id" },
  { table: "game_delegates", column: "game_id" },
  // Pick'em's lifecycle clock — published in migration 151, subscribed here in
  // 160. Open / lock / unlock live in these columns and in no config hash.
  { table: "pickem_games", column: "game_id" },
  // Pick'em's results (migration 159/160). See the header for why the
  // score-table exclusion does not reach this one.
  { table: "pickem_slate_games", column: "game_id" },
] as const;

type GameInput = { tripId: string; gameId: string };
type Invalidator = { invalidate: (input: GameInput) => unknown };

/** The narrow slice of tRPC utils a refresh may touch — structural, so the contract is
 *  testable without a React tree (same shape as `ScoreEventUtils`). */
export type GameRefreshUtils = {
  games: { getById: Invalidator; configHash: Invalidator; listOrganizers: Invalidator };
  matches: { listByGame: Invalidator };
  pickem: { get: Invalidator };
};

/**
 * What one `postgres_changes` event (or the SUBSCRIBED backfill) does to the cache.
 *
 * ── COALESCED, and the storm this exists for ────────────────────────────────
 *
 * The subscription is per ROW. A settings save rewrites rows — a points-only save on
 * a 16-player, 8-match game emits 25 events, a structural one (the clean-replace
 * branch) 49 — and every device with the game open runs this once per event. Fired
 * inline, each run invalidated five queries, and TanStack's invalidate cancels and
 * restarts an in-flight fetch (`cancelRefetch` defaults true), so every event reached
 * the server as a fresh request: 25–49 `games.configHash` calls per viewer per save,
 * and the batched link carrying `games.getById` up to 48 times in ONE request. That is
 * the 21× batch in the 09-11 stall.
 *
 * Measured on a local two-to-seven-device probe (production build, local Supabase):
 * per viewer 25→1 / 49→1 `configHash` calls; at six viewers the burst's HTTP requests
 * went 224→18 and 384→18, and 228 membership-gate fetch failures on the local stack
 * went to 0. Convergence now lands ~2.1–2.4s after the last event, where before it
 * was ~0.5s for one viewer and up to ~8.8s for six under the storm.
 *
 * WHAT IS INVALIDATED IS UNCHANGED — same five queries, same invalidate-only posture
 * (no setData). Only the timing changed, exactly as `makeScoreEventHandler` did for
 * score events. The cost is ≤ `COALESCE_WINDOW_MS` of added latency on a remote
 * config change, against a ~20s poll behind it.
 *
 * KEYS carry query + trip + game. The coalescer dedupes by key, so a key without the
 * game would let one game's refresh silently swallow another's that landed in the
 * same window — `useRealtimeGame.coalesce.test.ts` pins that. The `rtGame:` prefix
 * keeps these distinct from the score-event keys sharing the same module-wide window;
 * where both invalidate the same query for the same game it costs one extra
 * invalidate, which is the safe direction.
 */
export function makeGameRefresh(utils: GameRefreshUtils, tripId: string, gameId: string): () => void {
  const input = { tripId, gameId };
  return () => {
    coalesceInvalidation(`rtGame:getById:${tripId}:${gameId}`, () => {
      void utils.games.getById.invalidate(input);
    });
    coalesceInvalidation(`rtGame:matches:${tripId}:${gameId}`, () => {
      void utils.matches.listByGame.invalidate(input);
    });
    coalesceInvalidation(`rtGame:configHash:${tripId}:${gameId}`, () => {
      void utils.games.configHash.invalidate(input);
    });
    coalesceInvalidation(`rtGame:organizers:${tripId}:${gameId}`, () => {
      void utils.games.listOrganizers.invalidate(input);
    });
    // `pickem.get` is the ONLY query any pick'em surface reads — the sheet,
    // the phase strip, the settings mirror, Run and the board all come off
    // it. Without this line the subscription above fires and nothing on
    // screen changes, which is #1042 exactly: a handler invalidating three
    // queries the format reads none of. Harmless for other formats — an
    // invalidate on a query with no observer is a no-op.
    coalesceInvalidation(`rtGame:pickem:${tripId}:${gameId}`, () => {
      void utils.pickem.get.invalidate(input);
    });
  };
}

export function useRealtimeGame(tripId: string | undefined, gameId: string | null | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId || !gameId) return;

    const supabase = getRealtimeClient();
    const refresh = makeGameRefresh(utils, tripId, gameId);

    // One channel, one shared handler — any config write on any of the five tables
    // converges the view.
    const channel = supabase.channel(`game:${gameId}`);
    for (const { table, column } of GAME_REALTIME_SUBSCRIPTIONS) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `${column}=eq.${gameId}` },
        refresh,
      );
    }
    // Backfill on (re)connect: a change during a dead zone would otherwise stay stale
    // until the next hash poll. Refetching on the SUBSCRIBED tick self-heals (mirrors
    // useRealtimeMembers / useRealtimeChat). Coalesced like every other refresh, so a
    // reconnect costs at most one window of added latency.
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, gameId, utils]);
}
