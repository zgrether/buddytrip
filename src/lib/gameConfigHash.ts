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
