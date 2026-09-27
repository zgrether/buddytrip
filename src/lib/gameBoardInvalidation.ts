/**
 * THE ONE INVALIDATOR for "a game changed in a way the Games page shows" —
 * its settings saved, its state flipped live, finished, reset or deleted.
 *
 * ── The bug this exists for (PR 6b) ─────────────────────────────────────────
 *
 * Every game view kept its own copy of this, and every copy was written when
 * every game on the board belonged to a competition:
 *
 *     if (competitionId) {
 *       utils.competitions.leaderboard.invalidate(...);
 *       utils.competitions.faceBootstrap.invalidate(...);
 *       utils.games.listByTrip.invalidate(...);
 *     }
 *
 * A SIDE game has no competition, so a successful Save-with-Scoring refreshed
 * nothing the board reads: the game went live in the database (verified in
 * production) while the Games page kept showing its cached "New · Tap to set
 * up" row. And no copy knew about `games.sideBoard`, the side games' own query,
 * so even a cup game's change left that list stale.
 *
 * Same shape as `chatQueryInvalidation` (CLAUDE.md #22): the call sites differed
 * by which keys they remembered, and the delta between the lists WAS the bug.
 * Every game-scoped site calls this and nothing else, so a new board query is
 * added here once.
 *
 * Typed against a narrow structural shape rather than tRPC's utils proxy — it
 * documents the exact surface, and keeps this unit-testable without React.
 */
export type GameBoardUtils = {
  competitions: {
    leaderboard: { invalidate: (input: { tripId: string; competitionId: string }) => unknown };
    faceBootstrap: { invalidate: (input: { tripId: string }) => unknown };
  };
  games: {
    listByTrip: { invalidate: (input: { tripId: string }) => unknown };
    sideBoard: { invalidate: (input: { tripId: string }) => unknown };
  };
};

export function invalidateGameBoards(
  utils: GameBoardUtils,
  { tripId, competitionId }: { tripId: string; competitionId?: string | null }
): void {
  // The cup's standings only move for a cup game.
  if (competitionId) void utils.competitions.leaderboard.invalidate({ tripId, competitionId });
  // Everything else, for every game. `faceBootstrap` is not optional (CLAUDE.md
  // #10: the face re-seeds its children from it, undoing a child-only refresh).
  void utils.competitions.faceBootstrap.invalidate({ tripId });
  void utils.games.listByTrip.invalidate({ tripId });
  void utils.games.sideBoard.invalidate({ tripId });
}
