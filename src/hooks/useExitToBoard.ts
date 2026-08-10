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
 * ── All four formats use this (#808 closed the last one) ────────────────────
 * `NonGolfGameView` kept a bare `router.back()` for two more phases after this
 * hook existed, with the standalone exposure above intact — finalizing a
 * non-golf game reached from a push notification ejected you out of the app.
 *
 * Worth knowing why the machinery didn't catch it. Phase 3's `useGameFinalize`
 * unified the finalize AFTERMATH (optimistic lock, self-refresh, the three board
 * invalidations, the exit CALL) and `oneFinalizePath.test.ts` guards it — but
 * that guard targets the `games.finish` MUTATION CALL, deliberately, so it
 * proves there is one call site and one aftermath. It says nothing about what
 * each caller PASSES to that aftermath. `onExit` was a parameter, and three
 * formats passed `exitToBoard` while the fourth passed `router.back()` — a
 * shared pipeline with a per-format argument, which is CLAUDE.md #24's first
 * shape (inputs diverging under a shared output) wearing the hook's clothes.
 * A guard on the call site cannot see it; only a guard on the argument can.
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
