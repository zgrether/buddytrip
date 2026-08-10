"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc-client";
import { useMarkGameLocked } from "@/hooks/useGameCorrection";

/**
 * Finalize a game, and do the four things that must happen afterwards.
 *
 * ── Why this is a hook and not four handlers ────────────────────────────────
 * Every format called `games.finish` and then hand-wrote the same aftermath:
 * flip the cache to locked, refresh its own reads, invalidate the three board
 * queries, leave. Rack's and stroke's copies were near-identical; match's
 * differed only in refetching three queries where the others invalidated one;
 * non-golf's had drifted furthest and was missing a step.
 *
 * That aftermath is not incidental. Each line of it is a bug someone found:
 *
 *   markLocked            re-opening a just-finalized game painted "Save
 *                         scoring changes", because the last settled cache
 *                         value was still the optimistic `corrections_open`
 *                         from the correction flip.
 *   leaderboard           the board showed the old score until you left and
 *                         came back ("showed 4 to 2 only after I left and came
 *                         back") — it has no realtime sub for this, only a poll.
 *   faceBootstrap         invalidating the leaderboard ALONE is silently undone:
 *                         the Live face re-seeds it from the bootstrap on mount
 *                         and marks it fresh (CLAUDE.md #10).
 *   exit                  finalize is terminal; the result lives on the board
 *                         now. Popping rather than pushing is #550's two-backs
 *                         -to-leave fix.
 *
 * Four copies of a list like that is four chances to omit one, and non-golf
 * already had. A fifth format would have been a fifth chance.
 *
 * ── What stays with the caller ──────────────────────────────────────────────
 * The PRE-flight gate (match refuses to finalize over unconfirmed scores) is
 * format-specific and stays in the view. So is `refreshSelf` — what "this
 * surface's own reads" means genuinely differs, and match deliberately refetches
 * rather than invalidates.
 *
 * ── Ordering and awaiting are part of the contract ──────────────────────────
 * The board invalidations fire BEFORE the exit and none of them is awaited. Both
 * halves were learned the hard way: awaiting a refetch that feeds a panel the
 * exit is about to close held the close on data nothing would render, and those
 * refetches were frequently cancelled and restarted by the realtime and
 * config-hash waves the same write triggers (`invalidateCancelsRefetch.test.ts`).
 * The board is still mounted underneath (#12), so it repaints from its warm
 * cache while the invalidated queries refetch behind the paint.
 */
export function useGameFinalize({
  tripId,
  gameId,
  competitionId,
  refreshSelf,
  onExit,
  onError,
}: {
  tripId: string | null | undefined;
  gameId: string | null | undefined;
  /** Null for a standalone game — the board invalidations are skipped. */
  competitionId: string | null | undefined;
  /**
   * Refresh THIS surface's own reads. Optional because it legitimately varies:
   * rack and stroke invalidate `games.getById`; match refetches game + matches +
   * scores; non-golf reads its result from the leaderboard, which the board
   * invalidations below already cover.
   *
   * Never awaited — see the note above.
   */
  refreshSelf?: () => void;
  /** Leave the surface. `exitToBoard` for the golf formats; non-golf passes its
   *  own `onPosted`. Called last, after the invalidations are queued. */
  onExit: () => void;
  /**
   * Extra, surface-local error handling. The global `mutationCache.onError`
   * already surfaces every rejection as a toast, so this is additive — non-golf
   * uses it to put the server's message inline next to the button that failed,
   * which is a real difference worth keeping rather than flattening.
   */
  onError?: (error: unknown) => void;
}) {
  const utils = trpc.useUtils();
  const markLocked = useMarkGameLocked(tripId, gameId);
  /**
   * Retry policy, shared. Match and stroke set this; rack and non-golf did not —
   * a fourteenth divergence of the same kind, in which two formats rode out a
   * flaky finalize and two surfaced the failure to the user immediately.
   *
   * Finalize is worth retrying: it is idempotent (the recompute produces the
   * same result), it happens once at the end of a round, and the alternative is
   * a crew staring at an error on the one action that matters. Adopting the
   * considered value rather than the absence.
   */
  const finishGame = trpc.games.finish.useMutation({
    retry: 4,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 8000),
  });

  /**
   * @param placements non-golf's manual finishing order. Omitted by the golf
   *   formats, whose result is computed from `score_entries` server-side —
   *   `games.finish` is the ONE finalize and dispatches on `result_strategy`
   *   (CLAUDE.md #8), so this is the only per-format input it takes.
   * @returns true if the game was finalized; false if the mutation threw.
   *
   * A rejection is reported by the global `mutationCache.onError`
   * (lib/providers.tsx), which surfaces server rejections and not just
   * connectivity ones — so this returns false rather than throwing, and the
   * caller stays put. Staying put is the right recovery: no silent advance, and
   * the CTA stays tappable because the recompute is idempotent.
   */
  const finalize = useCallback(
    async (placements?: { entityId: string; position: number }[]): Promise<boolean> => {
      if (!tripId || !gameId) return false;
      try {
        await finishGame.mutateAsync(
          placements ? { tripId, gameId, placements } : { tripId, gameId },
        );
        // The symmetric half of `useOpenCorrection`'s optimistic flip, BEFORE
        // the surface closes — otherwise the last settled value stays
        // `corrections_open: true` and tapping back in shows the wrong CTA.
        markLocked();
        refreshSelf?.();
        if (competitionId) {
          utils.competitions.leaderboard.invalidate({ tripId, competitionId });
          utils.games.listByTrip.invalidate({ tripId });
          // Not optional: the child invalidate alone is undone by the face's
          // re-seed (CLAUDE.md #10).
          utils.competitions.faceBootstrap.invalidate({ tripId });
        }
        onExit();
        return true;
      } catch (e) {
        onError?.(e);
        return false;
      }
    },
    [tripId, gameId, competitionId, finishGame, markLocked, refreshSelf, onExit, onError, utils],
  );

  return { finalize, isPending: finishGame.isPending };
}
