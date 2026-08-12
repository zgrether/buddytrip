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
  /*
   * `entryOpen` / `openMatchId` USED TO BE HERE. They reported whether a match
   * was open in score entry via `?match=<id>`, and they existed for exactly one
   * reason, stated in their own doc: the COLUMN COUNT needed it synchronously,
   * because publishing it up through `GameChrome` would arrive one `useEffect`
   * late and paint a frame with the wrong number of columns.
   *
   * There is no column count any more (see breakpoints.ts), so their only
   * consumer went and they were left computing an answer nobody asked for.
   * `?match=` itself is untouched — it is still the deep-linkable entry state
   * the game views drive; this hook simply no longer reports on it.
   */
}

export function useCupPanel(
  tripId: string | null | undefined,
  /**
   * Whether this caller's surface is one that actually READS the result
   * (#763). Defaults to true, so `CompetitionFace` — which only mounts inside
   * the Cup slot — needs no argument and is unaffected.
   *
   * `AppShell` passes `visited.has("cup")`, because it calls this hook on every
   * trip page including the Trip tab, where nothing reads the answer: `twoPane`
   * is false on `effectiveView` alone there. A `?game=` deep link overrides the
   * gate below, since that genuinely needs the list on first paint.
   */
  opts?: { enabled?: boolean },
): CupPanelState {
  const search = useSearchParams();
  const openGameId = search.get("game");
  const wanted = (opts?.enabled ?? true) || !!openGameId;
  const games =
    trpc.games.listByTrip.useQuery(
      { tripId: tripId! },
      { ...STRUCTURE_QUERY, enabled: !!tripId && wanted },
    ).data ?? [];
  const openGame = openGameId
    ? (games as CupPanelGame[]).find((g) => g.id === openGameId)
    : undefined;
  const openType = openGame?.game_type_id ?? null;
  const panelOpen = !!openGame && opensAsPanel(openType);
  return {
    panelOpen,
    openGameId,
    openGame,
    openType,
    // Entry only counts while a game is actually open — a stray `?match=` with no
    // `?game=` is not a state the app can be in, and treating it as one would give
    // the shell a column count for a surface that isn't rendered.
  };
}

/**
 * Does the CONTENT BODY hand its scroll to the Cup's own columns?
 *
 * TRUE whenever the Cup is showing a game at all — drill-in or entry — because in
 * BOTH of those the Cup lays itself out as bounded, self-scrolling columns and the
 * body must not add a second scroller above them (one scroller per vertical chain,
 * #752). It is only false on the plain leaderboard, which is ordinary flow content
 * the body scrolls.
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
