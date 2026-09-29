/**
 * `resetGameConfigHash` — what a write to a HASHED game column owes the settings
 * page, from any surface that is not the settings page itself.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 * `games.saveConfig` is optimistically concurrent: the client sends the
 * `games.configHash` it opened with, and the server refuses the write if the
 * game's real fingerprint has moved since — "This game changed on another
 * device — reload before saving."
 *
 * `useConfigDraft` FREEZES that hash at the first edit (CLAUDE.md #18), so the
 * ~20s poll cannot move a live baseline mid-edit. The freeze is correct. What it
 * assumes is that the cached hash was TRUE when it froze.
 *
 * `/courses/new` broke that assumption and produced a conflict on a game nobody
 * else had opened. Its flow, exactly as reported:
 *
 *   1. open a game's settings, set the points  → baseline freezes at hash H1
 *   2. Course row → "search the wider database" → tap a result, which NAVIGATES
 *      to `/courses/new` (the game view unmounts)
 *   3. save there → `games.applyCourse` writes `course_id` + `scorecard_schema`,
 *      both of which are in `HASH_COLS.games`  → the real hash is now H2
 *   4. that page invalidated `games.getById`, `games.listByTrip` and
 *      `competitions.faceBootstrap` — but NOT `games.configHash`
 *   5. back on the game, `staleTime` is 60s, so the remount is served the CACHED
 *      H1 and does not refetch; the baseline re-freezes on H1
 *   6. set the matches, flip scoring, Save → baseHash H1 vs server H2 → CONFLICT
 *
 * The page LOOKS right the whole way through, which is what makes the message
 * read as a lie: `games.getById` WAS invalidated, so the new course renders. Only
 * the fingerprint is stale, and nothing renders it.
 *
 * ── Why reset, not invalidate ───────────────────────────────────────────────
 * `invalidate` marks the entry stale and leaves the value in place, so the
 * remount still renders H1 for one round trip — long enough for the next tap to
 * freeze the baseline on it. `reset` drops the value, so `serverHash` is
 * undefined until the fresh read lands and no baseline can form on the stale one.
 * `useConfigDraft` already handles a draft touched before the hash resolves (it
 * freezes late, deliberately), so this costs nothing.
 *
 * ── Why this is not covered by Realtime ─────────────────────────────────────
 * `useRealtimeGame` invalidates `games.configHash` on any `games` change and
 * re-runs on the SUBSCRIBED tick, which is why this is intermittent rather than
 * constant: whether it heals is a race between the socket connecting and the
 * user's next tap. `/courses/new` is a different route, so that hook is not even
 * mounted while the write happens. CLAUDE.md #19's rule — the poll and the socket
 * are backstops, not the mechanism — applies to your own write most of all.
 *
 * Typed against a narrow structural shape rather than tRPC's full utils proxy,
 * matching `invalidateChatQueries` / `invalidateGameRulesQueries`: it documents
 * exactly what this may touch and keeps the helper testable without a React tree.
 */

export type GameConfigHashUtils = {
  games: {
    configHash: { reset: (input: { tripId: string; gameId: string }) => unknown };
  };
};

/**
 * Call after ANY write that changes a column `readGameConfigHash` folds in — the
 * `games` columns in `HASH_COLS.games`, or a row in `game_matches` /
 * `game_participants` / `play_groups` / `game_delegates` / the bracket tables /
 * `pickem_games` — when the write does NOT go through `save_game_config`.
 *
 * Harmless when no settings page is open: resetting a query with no observer
 * drops a cached value that would have been refetched anyway.
 */
export function resetGameConfigHash(
  utils: GameConfigHashUtils,
  input: { tripId: string; gameId: string }
): void {
  utils.games.configHash.reset({ tripId: input.tripId, gameId: input.gameId });
}

export type TripGameStateUtils = {
  games: {
    configHash: { reset: () => unknown };
    getById: { invalidate: () => unknown };
    listByTrip: { invalidate: (input: { tripId: string }) => unknown };
  };
  matches: { listByGame: { invalidate: () => unknown } };
  playGroups: { listByGame: { invalidate: () => unknown } };
  teamAssignments: { list: { invalidate: () => unknown } };
  competitions: {
    faceBootstrap: { invalidate: (input: { tripId: string }) => unknown };
    leaderboard: { invalidate: () => unknown };
  };
};

/**
 * The refresh owed by a write that moves the hash of games it CANNOT NAME (#1507).
 *
 * Removing a trip member (or a placeholder) vacates their seats in every game of
 * the trip — `clearTripParticipation` → `vacateTripGameSeats`, in shared server
 * code — and the guest merge (linking a placeholder to an account, or claiming
 * an invite) repoints `game_participants`, match sides and delegates. Each of
 * those moves `readGameConfigHash` for some set of games the client does not
 * know, so it resets the fingerprint for ALL of them (the prefix, no input) and
 * re-pulls what renders the changed rows:
 *
 *  - `games.configHash` — RESET, not invalidated, for the reason
 *    `resetGameConfigHash` gives: an open draft must not re-freeze its baseline
 *    on the stale value.
 *  - the game reads that show seats and handicaps, and the roster (the removal
 *    also clears the person's team assignments).
 *  - `faceBootstrap` AND the leaderboard, never only the child (CLAUDE.md #10).
 *
 * Resetting a query nobody observes just drops a value that would be refetched
 * anyway, so the prefix costs nothing on a device with no game open.
 */
export function resetTripGameState(utils: TripGameStateUtils, tripId: string): void {
  utils.games.configHash.reset();
  utils.games.getById.invalidate();
  utils.games.listByTrip.invalidate({ tripId });
  utils.matches.listByGame.invalidate();
  utils.playGroups.listByGame.invalidate();
  utils.teamAssignments.list.invalidate();
  utils.competitions.faceBootstrap.invalidate({ tripId });
  utils.competitions.leaderboard.invalidate();
}
