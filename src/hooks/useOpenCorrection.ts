"use client";

import { useCallback } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc-client";
import type { AppRouter } from "@/server/router";

/** The cached `games.getById` row. Named explicitly per CLAUDE.md #2 — cache
 *  writes carry their type rather than inferring it at the call site. */
type GameById = inferRouterOutputs<AppRouter>["games"]["getById"];

/**
 * useOpenCorrection — the ONE "Correct a score" handler, for every format.
 *
 * ── Why this is a hook and not four copies ───────────────────────────────────
 * CLAUDE.md #24: golf's lock state has one home precisely because a format
 * skipping it is how the same bug gets found seven times. The correction ENTRY
 * was still four near-identical handlers (`MatchGameView`, `RackGameView`,
 * `StrokeGameView`, `NonGolfScoreboard`) — the second shape #24 warns about,
 * where the STATE is already unified (`gameLockState`) but the ACTION is a
 * private copy per view. They agreed only by coincidence; match had already
 * drifted to `gameQ.refetch()` where the other three used
 * `utils.games.getById.invalidate()`.
 *
 * ── What changed, and why it is faster ───────────────────────────────────────
 * The old handler awaited the mutation and THEN awaited a `games.getById`
 * refetch before the CTA could change. Two sequential round trips to learn a
 * boolean the client already knows the value of — `openCorrection` sets
 * `corrections_open = true` and has no other outcome.
 *
 * Worse, the awaited refetch was routinely THROWN AWAY. The same write fires
 * migration 096's broadcast and moves the config hash, so `useRealtimeGame` and
 * `useConfigSync` both invalidate the same query moments later — and
 * `invalidateQueries` defaults to `cancelRefetch: true`, which cancels the
 * in-flight refetch and starts another. The response carrying the answer arrived
 * and was discarded; the UI settled on a later one. #835 measured this (three
 * fetches, UI settling ~130 ms after the first true payload landed) and named
 * the mechanism as unverified — `invalidateCancelsRefetch.test.ts` now verifies
 * it against the real library, in both directions.
 *
 * So the flip is applied to the cache DIRECTLY and the mutation confirms it.
 *
 * ── The optimism follows CLAUDE.md #1, NOT `onMutate` ────────────────────────
 * The enforced pattern here is hand-rolled `getData` → `setData`, with
 * `invalidate()` (re-pull server truth) as the rollback on error — explicitly
 * NOT the `onMutate` + snapshot-restore idiom, which `src/components/games/` has
 * zero instances of. A snapshot restore would also be WRONG here: by the time a
 * rejection lands, the realtime and config-hash waves may already have written
 * newer server state into that cache entry, and restoring a snapshot would put
 * back a value that is stale in a second, unrelated way. Re-fetching cannot.
 *
 * ── Why the optimistic flip is safe ──────────────────────────────────────────
 * `openCorrection` refuses anything but a `complete` game, and the button that
 * calls this is only rendered when `gameLifecycle` says `canCorrect` — which is
 * `canEdit && isLocked`, i.e. already `complete` and not already correcting. The
 * optimistic value and the server's are the same computation over the same
 * inputs; the only ways to diverge are a permission change or a concurrent
 * finalize, both of which reject and land on the rollback. Nothing destructive
 * rides on it either: entering correction mode only makes score entry legal
 * again (`scores.upsertEntry` re-checks server-side on every write, so an
 * optimistic client cannot grant itself scoring access — the access model is
 * unchanged).
 *
 * The board invalidations are UNCHANGED and still fire — `corrections_open` is a
 * `games` column, snapshotted by the bootstrap and carried on the board's
 * GameRow, so `faceBootstrap` must be invalidated or the face's re-seed silently
 * undoes the child invalidate (CLAUDE.md #10). They are simply not AWAITED,
 * which they never needed to be: the board is mounted beneath the panel and
 * repaints from its warm cache while they refetch behind it.
 */
export function useOpenCorrection(
  tripId: string | null | undefined,
  gameId: string | null | undefined,
  /** The GAME's competition, or null/undefined for a standalone game. */
  competitionId: string | null | undefined,
  /** Surfaced to the caller so a view with its own error slot can show it. The
   *  global `mutationCache.onError` toast fires regardless. */
  onError?: (message: string) => void
) {
  const utils = trpc.useUtils();
  const openCorrection = trpc.games.openCorrection.useMutation();

  const correct = useCallback(async () => {
    if (!tripId || !gameId) return;
    const input = { tripId, gameId };

    // Optimistic: the CTA, the lock state and score editability all read this
    // one boolean, so flipping it here is the whole transition.
    utils.games.getById.setData(input, (prev: GameById | undefined) =>
      prev ? { ...prev, corrections_open: true } : prev
    );

    try {
      await openCorrection.mutateAsync(input);
      // Server truth, un-awaited — the optimistic value is already on screen and
      // this only reconciles it.
      void utils.games.getById.invalidate(input);
      void utils.games.listByTrip.invalidate({ tripId });
      if (competitionId) void utils.competitions.faceBootstrap.invalidate({ tripId });
    } catch (e) {
      // Rollback = re-pull server truth (CLAUDE.md #1), not a snapshot restore.
      void utils.games.getById.invalidate(input);
      onError?.(e instanceof Error ? e.message : "Failed to reopen for correction");
    }
  }, [tripId, gameId, competitionId, utils, openCorrection, onError]);

  return { correct, isPending: openCorrection.isPending };
}
