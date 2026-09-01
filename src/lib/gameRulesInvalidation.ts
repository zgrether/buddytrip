/**
 * The ONE invalidation set for "this game's rules of the day changed."
 *
 * ── Why this is shared, not a list inside `GameRulesSheet` ───────────────────
 * `GameRulesSheet` is the single surface that WRITES `rules_for_today` outside
 * the settings page's atomic Save (see its header for why that exception
 * exists). It is rendered by `GameChromeActions` for every format, and it knows
 * nothing about which of them is underneath it — which is exactly how it came to
 * refresh two queries pick'em does not read.
 *
 * The sheet invalidated `games.getById` + `games.listByTrip`. Four formats read
 * `games.getById`, so for them the edit came straight back. Pick'em reads
 * `pickem.get` and nothing else — the sheet, the phase strip, Run, the board and
 * the settings mirror all come off that one query — so the write landed in the
 * database and the sheet re-opened showing the format starter, i.e. showing the
 * edit as though it had never been made.
 *
 * That is CLAUDE.md #22's rule ("one invalidator, not two lists that happen to
 * match") and #1042's shape ("a handler invalidating queries the format reads
 * none of") arriving on the rules path. `useRealtimeGame` already learned this
 * lesson and invalidates `pickem.get` alongside the game queries; this is the
 * same set, in one place, so the next surface to write the field cannot pick up
 * a shorter version of it.
 *
 * Typed against a narrow structural shape rather than tRPC's full utils proxy —
 * the same posture as `invalidateChatQueries` and `ScoreEventUtils`. It
 * documents exactly what this is allowed to touch and keeps the helper unit
 * testable without a React tree.
 */

export type GameRulesInvalidationUtils = {
  games: {
    getById: { invalidate: (input: { tripId: string; gameId: string }) => unknown };
    listByTrip: { invalidate: (input: { tripId: string }) => unknown };
  };
  /**
   * Pick'em's only read. Invalidating it is a no-op for the other four formats —
   * a query with no observer does not refetch — which is why this set is
   * unconditional rather than branched on the game's format. A branch would need
   * the format at the call site, and the sheet deliberately does not have it.
   */
  pickem: {
    get: { invalidate: (input: { tripId: string; gameId: string }) => unknown };
  };
};

export function invalidateGameRulesQueries(
  utils: GameRulesInvalidationUtils,
  input: { tripId: string; gameId: string }
): void {
  const { tripId, gameId } = input;
  // The four golf / non-golf surfaces, which read the game row directly.
  utils.games.getById.invalidate({ tripId, gameId });
  // The board's game list — `MemberSetupView` renders `rules_for_today` from it.
  utils.games.listByTrip.invalidate({ tripId });
  // Pick'em, whose whole surface is this one query.
  utils.pickem.get.invalidate({ tripId, gameId });
}
