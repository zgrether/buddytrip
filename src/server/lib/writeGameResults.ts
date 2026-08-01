import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

/**
 * The ONE write path for `game_results` (#776).
 *
 * Every scoring engine used to persist its results as a bare DELETE followed by
 * a bare INSERT — two separate PostgREST requests, neither error-checked. That
 * shape had two problems, and only one of them was about error checking:
 *
 *  1. A committed delete followed by a failed insert left the game with FEWER
 *     results than it started with. Not stale — EMPTY, which the UI reads as
 *     "no results yet".
 *  2. Migration 096's trigger is FOR EACH ROW on this table, so the delete
 *     emitted one broadcast PER ROW telling every client to refetch the
 *     leaderboard, all before the insert ran. That window was reachable on the
 *     HAPPY path, with nothing failing at all.
 *
 * Both close by committing the pair in one transaction, which supabase-js can't
 * express — hence `write_game_results` (migration 100). This module is the
 * typed caller for it. The RPC is a dumb writer (Design A, per
 * `save_game_config`): everything derived is computed HERE, in TS, so
 * CLAUDE.md #8's "pure scoring lives in the client-safe module" is untouched.
 */

/** A `game_results` row, already fully derived by the caller. `id` is minted
 *  caller-side (as before) so the RPC stays a pure writer. */
export interface GameResultRow {
  id: string;
  entity_id: string;
  entity_type: "user" | "team" | "play_group";
  /** NUMERIC in the DB (migration 048 widened it) — halved matches award .5. */
  raw_score?: number | null;
  position?: number | null;
  /** Rack's team tally. Null for every other format. */
  points?: number | null;
  competition_points_earned?: number | null;
}

/** Match play's per-match result columns, folded into the same transaction so a
 *  game's whole derived state commits together. Pairings are never touched. */
export interface MatchResultUpdate {
  id: string;
  result: string | null;
  margin: string | null;
  status: string;
}

/**
 * Which existing rows this write replaces. The three engines genuinely differ
 * here and the difference is load-bearing, not incidental:
 *  - `all`          — replace every row for the game
 *  - `entity_ids`   — replace only the listed entities (match play's
 *                     `skipComplete` freeze boundary: a complete match's rows
 *                     must survive an incremental re-derive)
 *  - `entity_type`  — replace only one entity_type (match play's team rows,
 *                     which must not disturb the user rows written moments
 *                     earlier in the same finalize)
 */
export type ResultScope =
  | { kind: "all" }
  | { kind: "entity_ids"; entityIds: string[] }
  | { kind: "entity_type"; entityType: "user" | "team" | "play_group" };

/**
 * How a write failure is surfaced. **The atomicity is unconditional — only the
 * throw is conditional.** Both modes commit through the same RPC; they differ
 * only in what the caller sees afterwards.
 *
 * - `"throw"` — the FINALIZE path (`games.finish`). A game marked complete with
 *   an empty results table is worse than a game that didn't finish, and the
 *   failure is recoverable: status stays non-complete, the computes are
 *   idempotent, so re-tapping Finish re-runs and recovers. This also ends a
 *   divergence rather than introducing a behaviour — `writeManualResults` (the
 *   fourth format) has always checked and thrown on this same table.
 *
 * - `"log"` — the SETUP paths (`matches.*`, `playGroups.*`, `saveConfig`'s
 *   post-save recompute). Deliberate, and NOT laziness:
 *     · `saveConfig` throwing would mean the settings RPC COMMITTED but the
 *       mutation returns an error — config saved, user told it failed. That is
 *       a worse lie than the one #776 fixes.
 *     · the `matches.*` writes are NOTIFICATIONS.md's NEVER-marked mechanical
 *       setup paths; making "pair a match" able to fail on a results-write
 *       error is not an improvement.
 *   These are `skipComplete` recomputes of DERIVED state during setup — the
 *   next recompute reproduces them from the same inputs, so a failure is a
 *   missed refresh, not lost data. It is logged loudly rather than swallowed.
 */
export type WriteFailureMode = "throw" | "log";

export interface WriteGameResultsInput {
  gameId: string;
  rows: GameResultRow[];
  scope: ResultScope;
  matchUpdates?: MatchResultUpdate[];
  /**
   * Defaults to `"log"` — the SETUP behaviour, which is 9 of the 12 engine call
   * sites and preserves their existing behaviour exactly.
   *
   * The three finalize sites pass `"throw"` explicitly, and that is not left to
   * memory: `writeGameResults.guard.test.ts` asserts `games.finish`'s dispatch
   * passes the finalize mode, so a new format arm that forgets it fails the
   * build rather than silently reintroducing the swallowed-failure bug.
   */
  onFailure?: WriteFailureMode;
}

/**
 * Commit a game's results atomically. Never partially applies: the delete, the
 * insert, and match play's per-match columns all land together or not at all.
 */
export async function writeGameResults(
  supabase: SupabaseClient,
  input: WriteGameResultsInput
): Promise<void> {
  const mode: WriteFailureMode = input.onFailure ?? "log";

  const { error } = await supabase.rpc("write_game_results", {
    p_game_id: input.gameId,
    p_rows: input.rows,
    p_scope: input.scope.kind,
    p_entity_ids: input.scope.kind === "entity_ids" ? input.scope.entityIds : null,
    p_entity_type: input.scope.kind === "entity_type" ? input.scope.entityType : null,
    p_match_updates: input.matchUpdates ?? [],
  });

  if (!error) return;

  if (mode === "throw") {
    // NOT `UNAUTHORIZED`: authExpiry.ts treats a 401 as a dead session and hard-
    // navigates to /login, so the wrong code here logs someone out mid-round.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to save results: ${error.message}`,
    });
  }

  // Setup path — loud in the logs, not in the user's face. See WriteFailureMode.
  console.error("[writeGameResults] results write failed (setup path, not surfaced)", {
    gameId: input.gameId,
    scope: input.scope.kind,
    error: error.message,
  });
}
