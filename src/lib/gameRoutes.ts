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
  gameId: string
): string | null {
  if (!gameTypeId) return null;
  const seg = GAME_ROUTES[gameTypeId];
  if (seg) return `/trips/${tripId}/games/${seg}?game=${gameId}`;
  // Non-golf manual games now have a real scoreboard PAGE (promoted from the old
  // post-results modal) — route there instead of opening a modal in place.
  if (isManualGameType(gameTypeId)) return `/trips/${tripId}/games/${MANUAL_ROUTE}?game=${gameId}`;
  return null;
}

/** Golf games carry a scorecard (the scorecard column is golf-only). "Golf" is
 *  proxied by "has a known golf game-board route"; a manual win/lose/halve side
 *  event (no golf route) is correctly excluded. */
export function isGolfFormat(gameTypeId: string | null): boolean {
  return !!gameTypeId && gameTypeId in GAME_ROUTES;
}
