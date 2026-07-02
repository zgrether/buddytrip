import { isManualGameType } from "@/lib/gameTypes";

/**
 * Game-board routing — the pure mapping from a game's type to the page you land
 * on from the leaderboard. Kept client-safe + React-free (no component imports)
 * so it's unit-testable on its own and importable anywhere.
 */

/** Map known GOLF game type IDs to their game-board route segment. (Golf-only —
 *  `isGolfFormat` keys off this; non-golf gets its page via `MANUAL_ROUTE`, which
 *  deliberately does NOT make it read as golf.) */
const GAME_ROUTES: Record<string, string> = {
  gtt_stroke_play: "new",
  gtt_match_play_singles: "match/new",
  gtt_match_play_doubles: "match/new",
  gtt_rack_n_stack: "rack/new",
};

/** The shared non-golf (manual) scoreboard route segment — every manual format
 *  lands on the one lifecycle page (W-NONGOLF lifecycle surface), the non-golf
 *  twin of golf's per-format pages. */
export const MANUAL_ROUTE = "manual";

export function gameHref(
  tripId: string,
  gameTypeId: string | null,
  gameId: string,
  /** `settings: true` deep-links to the game's settings (configuration) page
   *  instead of the scoreboard pass-through — the leaderboard uses this to drop
   *  an owner/delegate straight into setup for a not-yet-scoring game (the page
   *  honors `?settings=1` via useGameSettingsOverlay). Members / scoring-mode
   *  games never get it (decided at the call site).
   *
   *  `scorecard: true` → the standalone EMPTY scorecard preview (Spec 5a): the
   *  course structure (par/yardage/stroke-index, front+back) read from the game's
   *  PERSISTED snapshot, no scores. Format-agnostic (one page for every golf
   *  format — it only needs the schema), so it's a single route, not per-format.
   *  Golf-only; a non-golf game (no course) returns null → no scorecard link. */
  opts?: { settings?: boolean; scorecard?: boolean }
): string | null {
  if (!gameTypeId) return null;
  if (opts?.scorecard) {
    return isGolfFormat(gameTypeId) ? `/trips/${tripId}/games/scorecard?game=${gameId}` : null;
  }
  const suffix = opts?.settings ? "&settings=1" : "";
  const seg = GAME_ROUTES[gameTypeId];
  if (seg) return `/trips/${tripId}/games/${seg}?game=${gameId}${suffix}`;
  // Non-golf manual games now have a real scoreboard PAGE (promoted from the old
  // post-results modal) — route there instead of opening a modal in place.
  if (isManualGameType(gameTypeId)) return `/trips/${tripId}/games/${MANUAL_ROUTE}?game=${gameId}${suffix}`;
  return null;
}

/** Golf games carry a scorecard (the scorecard column is golf-only). "Golf" is
 *  proxied by "has a known golf game-board route"; a manual win/lose/halve side
 *  event (no golf route) is correctly excluded. */
export function isGolfFormat(gameTypeId: string | null): boolean {
  return !!gameTypeId && gameTypeId in GAME_ROUTES;
}

/** Match-play formats (singles + doubles) — the ONLY formats that open as a
 *  layered PANEL over the persistent leaderboard (Spec 2 Phase 1). Every other
 *  format still navigates to its route via {@link gameHref}; the panel is proven
 *  on match play first, then extended. */
export function isMatchPlayFormat(gameTypeId: string | null): boolean {
  return gameTypeId === "gtt_match_play_singles" || gameTypeId === "gtt_match_play_doubles";
}
