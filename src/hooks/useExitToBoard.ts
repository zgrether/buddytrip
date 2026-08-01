"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useInGamePanel } from "@/components/games/GameChrome";

/**
 * Leave a finished game and return to where its result now lives.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Finalizing a golf game left you sitting on the scoreboard. Non-golf has always
 * navigated away (`NonGolfScoreboard` → `onPosted()` → `router.back()`), so the
 * four formats disagreed about what finishing means. Reported from the field for
 * stroke, but stroke was CONFORMING — rack and match did the same thing.
 *
 * ── Why `back()` and not `push()` in a panel ─────────────────────────────────
 * This is the part that is easy to get wrong, and it has been got wrong before.
 * `MatchGameView` carries the scar (#550 Task 4): finalize used to `go("overview")`,
 * which PUSHED another entry onto the nav stack and produced a two-backs-to-leave
 * bug. The fix at the time was to navigate nowhere at all.
 *
 * Under CLAUDE.md #12 a game opens as a client-overlay PANEL via History
 * `pushState` (`?game=`), over a leaderboard that stays mounted. So the honest
 * inverse of "open the panel" is `back()` — it POPS the entry the panel pushed.
 * A `push()` to the leaderboard would leave the `?game=` entry underneath and
 * resurrect exactly #550's bug. Popping also means the board repaints instantly
 * from its warm cache, which the invalidations fired just before this make fresh.
 *
 * ── And why `back()` alone is NOT enough ─────────────────────────────────────
 * `back()` is only the inverse of a panel open. On a standalone `/games/...`
 * route, or a cold deep-link from a push notification, there is no `?game=` entry
 * to pop and `back()` goes wherever the user came from — possibly out of the app
 * entirely. `useInGamePanel()` is the existing, reliable discriminator (it just
 * asks whether a `GameChrome` provider is present), so the standalone case gets
 * an explicit destination instead.
 *
 * That destination mirrors what every game view's `onDeleted` already does, so
 * "left the game" lands in one place regardless of why you left.
 *
 * **Note:** `NonGolfGameView` still calls bare `router.back()` and therefore still
 * has the standalone exposure described above. Left alone deliberately — it was
 * out of scope for the change that added this — and adopting this hook there is a
 * one-line swap.
 */
export function useExitToBoard(
  tripId: string | undefined,
  /** The GAME's competition, or null for a standalone game. */
  competitionId: string | null | undefined
): () => void {
  const router = useRouter();
  const inPanel = useInGamePanel();

  return useCallback(() => {
    if (inPanel) {
      router.back();
      return;
    }
    if (!tripId) return;
    router.push(competitionId ? `/trips/${tripId}/leaderboard` : `/trips/${tripId}`);
  }, [inPanel, router, tripId, competitionId]);
}
