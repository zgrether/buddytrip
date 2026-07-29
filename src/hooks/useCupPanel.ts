"use client";

import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { opensAsPanel } from "@/lib/gameRoutes";

/**
 * Is the Cup showing a game as a side PANE — i.e. is the board in two-pane mode?
 *
 * ── Why this is a hook and not a local derivation ───────────────────────────
 * Two components need the same answer and they are two levels apart.
 * `CompetitionFace` needs it to build the grid; `AppShell` needs it to decide
 * **who owns the scroll** — because in two-pane the content body must NOT scroll
 * (each pane does), and the body lives in AppShell.
 *
 * Deriving it twice is how the two drift and disagree, and the disagreement is
 * silent: the board would render two panes while the shell still thought it owned
 * the scroll, which is exactly the double-scrollbar this exists to prevent. So the
 * RULE lives here once and both callers evaluate it against the same React Query
 * cache — `games.listByTrip` is `STRUCTURE_QUERY`, so the second caller is a cache
 * read, not a second fetch.
 *
 * Not published up through `GameChrome` (the shell's other publish-up channel)
 * for two reasons: that publishes in a `useEffect`, so the shell would learn one
 * frame late and paint a frame with the wrong scroller; and chrome presence means
 * "a game is open", which stays true when the user switches to the Trip tab with a
 * game still open — see `twoPane` below for why that distinction matters.
 *
 * `opensAsPanel` (not `!!openGameId`) is the same allowlist the panel host itself
 * branches on, so a format that doesn't panel can never flip scroll ownership.
 */
/** The game row as the board's list carries it — enough for the panel host's
 *  format branch and its warm-cache seed. */
export interface CupPanelGame {
  id: string;
  game_type_id: string | null;
}

export interface CupPanelState {
  /** A panel-capable game is open via `?game=`. */
  panelOpen: boolean;
  /** The `?game=` value, or null. */
  openGameId: string | null;
  /** The open game's row, or undefined. The host seeds `games.getById` from it. */
  openGame: CupPanelGame | undefined;
  /** The open game's type, or null when nothing panel-capable is open. */
  openType: string | null;
}

export function useCupPanel(tripId: string | null | undefined): CupPanelState {
  const search = useSearchParams();
  const openGameId = search.get("game");
  const games =
    trpc.games.listByTrip.useQuery(
      { tripId: tripId! },
      { ...STRUCTURE_QUERY, enabled: !!tripId },
    ).data ?? [];
  const openGame = openGameId
    ? (games as CupPanelGame[]).find((g) => g.id === openGameId)
    : undefined;
  const openType = openGame?.game_type_id ?? null;
  return { panelOpen: !!openGame && opensAsPanel(openType), openGameId, openGame, openType };
}

/**
 * Does the CONTENT BODY hand its scroll to the panes?
 *
 * `panelOpen` alone is not the condition, and getting that wrong is a real bug:
 * `AppShell` keeps all three tab slots mounted and hides the inactive ones, so a
 * game left open while the user switches to the Trip tab keeps `panelOpen` true
 * with the Cup hidden. Switching the body to `overflow-hidden` on `panelOpen`
 * alone would leave the **Trip tab unscrollable**.
 */
export function isTwoPane(panelOpen: boolean, mainView: string): boolean {
  return panelOpen && mainView === "cup";
}
