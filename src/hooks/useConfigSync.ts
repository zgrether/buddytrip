"use client";

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc-client";

/**
 * The game-state sync poll cadence. Zach's spec: scores/config reconcile within
 * ~15–30s ("delayed-a-bit is fine; not a live broadcast"). 20s sits in the
 * middle. Used for BOTH the score poll (refetchInterval on scores.listByGame in
 * each view) and this config-hash poll, so — because the tRPC client batches —
 * the two fire on the same tick and coalesce into ONE HTTP round-trip.
 */
export const GAME_SYNC_INTERVAL_MS = 20_000;

/**
 * useConfigSync — the CHEAP half of cross-device game-state reconcile.
 *
 * The stale-state root: a game's CONFIG (modifiers/rules/settings/course/status +
 * groupings + matchups + handicaps) is cached as STRUCTURE (staleTime: Infinity)
 * and only refetched on an explicit invalidation — which is LOCAL to the device
 * that made the change. A second device never hears about it (the reproduced
 * grouping-swap; the danger case of an unseen mid-round modifier/rule change).
 *
 * The fix, per Zach's design: poll a cheap server-computed CONFIG HASH
 * (`games.configHash` — a short string, NOT the heavy config) on the same tick as
 * the score poll. Hold the last hash; when the server's differs, the config
 * actually changed, so invalidate the full-config queries (getById + the format's
 * matchups/groupings) to converge. When it MATCHES, do nothing — no heavy config
 * refetch when nothing changed (the efficiency win). Convergence is SILENT — the
 * caller's invalidations quietly re-render; no toast/notification.
 *
 * Scoped: pass `enabled` = the game panel is open + showing the board, so the
 * poll only runs where it's needed (paused when the tab is hidden via
 * refetchIntervalInBackground: false — matches the leaderboard poll).
 *
 * Baseline: the FIRST observed hash is the baseline (no refetch) — it represents
 * the config the view just fetched on open. Every change AFTER that is caught.
 * (A config change that lands in the &lt;20s window between panel-open and the first
 * poll on a WARM-cached reopen isn't detected until the next real change — the
 * same warm-cache staleness that exists today; the continuous-open danger case
 * this targets is fully covered.)
 *
 * @param onConfigChanged the view's structure invalidations. Wrap in useCallback
 *   so it's identity-stable; it's fine if it changes, the effect only ACTS on a
 *   genuine hash change.
 */
export function useConfigSync(
  tripId: string | undefined,
  gameId: string | null | undefined,
  enabled: boolean,
  onConfigChanged: () => void,
) {
  const lastHash = useRef<string | null>(null);
  const active = enabled && !!tripId && !!gameId;

  const hashQ = trpc.games.configHash.useQuery(
    { tripId: tripId!, gameId: gameId! },
    {
      enabled: active,
      refetchInterval: GAME_SYNC_INTERVAL_MS,
      refetchIntervalInBackground: false,
    },
  );

  // Reset the baseline when the watched game changes, so reopening a different
  // game doesn't compare against the previous game's hash.
  useEffect(() => {
    lastHash.current = null;
  }, [gameId]);

  const serverHash = hashQ.data?.hash;
  useEffect(() => {
    if (!serverHash) return;
    if (lastHash.current === null) {
      lastHash.current = serverHash; // first observation = baseline, don't refetch
      return;
    }
    if (serverHash !== lastHash.current) {
      lastHash.current = serverHash;
      onConfigChanged(); // silent convergence — invalidate full config
    }
  }, [serverHash, onConfigChanged]);
}
