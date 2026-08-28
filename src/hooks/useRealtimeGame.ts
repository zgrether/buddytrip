"use client";

import { useEffect } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc-client";

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

export function useRealtimeGame(tripId: string | undefined, gameId: string | null | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tripId || !gameId) return;

    const supabase = getRealtimeClient();
    const refresh = () => {
      utils.games.getById.invalidate({ tripId, gameId });
      utils.matches.listByGame.invalidate({ tripId, gameId });
      utils.games.configHash.invalidate({ tripId, gameId });
      utils.games.listOrganizers.invalidate({ tripId, gameId });
      // `pickem.get` is the ONLY query any pick'em surface reads — the sheet,
      // the phase strip, the settings mirror, Run and the board all come off
      // it. Without this line the subscription above fires and nothing on
      // screen changes, which is #1042 exactly: a handler invalidating three
      // queries the format reads none of. Harmless for other formats — an
      // invalidate on a query with no observer is a no-op.
      utils.pickem.get.invalidate({ tripId, gameId });
    };

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
    // useRealtimeMembers / useRealtimeChat).
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, gameId, utils]);
}
