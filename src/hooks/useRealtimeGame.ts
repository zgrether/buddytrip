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
 * status / course / modifiers / points / entry_mode / scoring_enabled), `game_matches`
 * (matchups), `game_participants` + `play_groups` (rosters / handicaps), and
 * `game_delegates` — so it fires on exactly the rows the config fingerprint is built
 * from. On any of them, PURE INVALIDATE the game's read queries (no setData). Score
 * tables are deliberately NOT here — scores have their own poll + outbox (#15/#16).
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
 * The config tables this hook watches, and the column each is filtered by. EXACTLY
 * readGameConfigHash's fan-out. The game row filters by its PK (`id`); the child
 * tables by `game_id`. Exported so a test can lock the set + the filter columns
 * without a DOM renderer (the real risk is a wrong table or a `id`↔`game_id` slip).
 */
export const GAME_REALTIME_SUBSCRIPTIONS = [
  { table: "games", column: "id" },
  { table: "game_matches", column: "game_id" },
  { table: "game_participants", column: "game_id" },
  { table: "play_groups", column: "game_id" },
  { table: "game_delegates", column: "game_id" },
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
