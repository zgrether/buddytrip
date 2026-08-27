"use client";

import type { ReactElement } from "react";
import { isMatchPlayFormat, isRackFormat, isStrokeFormat, isPickemFormat } from "@/lib/gameRoutes";
import { MatchGameView } from "@/components/games/MatchGameView";
import { RackGameView } from "@/components/games/RackGameView";
import { NonGolfGameView } from "@/components/games/NonGolfGameView";
import { StrokeGameView } from "@/components/games/StrokeGameView";
import { PickemGameView } from "@/components/games/PickemGameView";

/**
 * gamePanelView — picks the format's view for the board's game panel, **keyed by
 * the game id**.
 *
 * ── The key is the whole point (#744) ───────────────────────────────────────
 * The panel opens over a persistent board via `?game=` (CLAUDE.md #12), and at
 * `lg+` `CompetitionFace` lays the board out as `[game list | game pane]` with the
 * pane `lg:static` — so the list stays interactive BESIDE the open game, by
 * design. Tapping a second game there moves `?game=` A→B without a route change:
 * `openGameId` is derived, so `panelOpen` never dips false, and the element sits
 * at the same position in the tree. React reconciles same-position + same-type +
 * same-key as THE SAME INSTANCE and re-renders it rather than remounting.
 *
 * `MatchGameView` and `RackGameView` capture `gameId` into `useState` at mount,
 * so the instance kept every query, the outbox key, the app-bar title and the
 * score write pointed at game A. The pane silently did not navigate, and a score
 * entered afterwards was written to game A.
 *
 * Keying on the game id makes the key differ across a swap, which is what tells
 * React to unmount and mount fresh. Everything per-game resets by construction.
 *
 * ── Why a key and not "derive gameId from the URL" ──────────────────────────
 * Deriving the id live fixes the id and NOTHING ELSE, and the id is one of ~25
 * pieces of per-game state in these two views. The dangerous one is the score map:
 * `MatchGameView`'s `mergedFor` spreads local `values` LAST (local wins over
 * server), and a 1v1 side's participant id IS a user id — and two match games in
 * one competition share their users. So a live-id fix would refetch game B
 * correctly while game A's optimistic scores rendered on B's card, fed
 * `buildDecided` into a wrong match state, and persisted A's numbers into B on the
 * next advance. That is strictly worse than the bug it fixes: today the display
 * and the write at least agree. A remount discards all of it at once.
 *
 * (A remount is defensible here in a way it is not for trip context. For a
 * DIFFERENT GAME, discarding local state is the correct semantics — it is a
 * different game — and the warm-slot argument does not apply.)
 *
 * ── Why this is not applied to the standalone `/games/...` routes ───────────
 * It would break them. On the standalone stroke route `start()` does
 * `router.replace(...?game=<newId>)` right after `setCreatedGame(...)`, and "Play
 * again" drops `?game=` again — keying the route wrapper on the search param would
 * remount mid-create and wipe `createdGame`/`selected`/`values`. The panel has no
 * such transition: `panelOpen` requires an already-existing `openGame`, so
 * `?game=` is a real id for the whole life of the instance and only ever changes
 * by swapping to another game. A `?game=` swap is not reachable on those routes
 * today anyway (every format panels, so the board never uses the href) — it is
 * latent, not live.
 *
 * ── The format boundary, and why it is tested ──────────────────────────────
 * A cross-format swap already remounted before this fix, because the ternary
 * changes the element TYPE and React never reuses an instance across types. Only
 * SAME-format swaps (match→match, rack→rack) reused it. `gamePanelView.test.tsx`
 * pins both directions so that collapsing this ternary into something
 * type-uniform later can't silently reintroduce the bug.
 */
export function gamePanelView(openType: string | null, openGameId: string): ReactElement {
  // Each branch keys on the game id. Adding a format here without a key
  // reintroduces #744 for that format — `gamePanelView.test.tsx` iterates the
  // `opensAsPanel` allowlist and fails the build if any branch comes back unkeyed.
  if (isMatchPlayFormat(openType)) return <MatchGameView key={openGameId} />;
  if (isRackFormat(openType)) return <RackGameView key={openGameId} />;
  if (isStrokeFormat(openType)) return <StrokeGameView key={openGameId} />;
  if (isPickemFormat(openType)) return <PickemGameView key={openGameId} />;
  // Non-golf is the deliberate fall-through, and only ever reached after
  // `opensAsPanel` has already vetted the type (CompetitionFace gates on it).
  return <NonGolfGameView key={openGameId} />;
}
