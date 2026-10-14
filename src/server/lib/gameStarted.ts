import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "./rowOrThrow";

/**
 * "Which of these games have begun producing results?" — the ONE read of
 * `public.game_started` (migrations 161/170) for every caller that needs it.
 *
 * ── Why this module exists (#1151/#1018) ──────────────────────────────────
 *
 * The view was created because three call sites were each deriving "started"
 * from the format-specific tables they happened to know about, and 161's header
 * says what the fix is: "A new format adds an arm HERE rather than a fourth
 * query at a call site." Only `competitionLeaderboard` was moved onto it. The
 * two REMOVAL guards were not, and went on counting `score_entries` +
 * `match_hole_outcomes` themselves — which is zero rows for a pick'em however
 * many results are in, so both answered "nobody has played this" for a game
 * that had already paid the cup.
 *
 * The view has four arms today: golf score entry, outcome-mode hole outcomes,
 * pick'em slate results, and declared `game_matches` results. A caller reading
 * it gets every one of them and will get the fifth without being edited, which
 * is the entire point.
 *
 * ── Why a helper and not two copies of the same query ─────────────────────
 *
 * `findContributionBlockers` and `competitionHasResults` were two guards asking
 * one question, and they had already drifted: the first grew a second source
 * for outcome-mode play (#1016), the second never did. Two hand-edited copies
 * of a predicate are how that happens, so there is one function and every
 * caller uses it — a new arm in the view reaches them all without a sweep.
 * (The first was retired in PR 8d-3, when removal stopped judging history:
 * the archive decides that, in the database. `competitionHasResults`, via
 * `anyGameStarted`, is the caller today.)
 *
 * ── RLS ───────────────────────────────────────────────────────────────────
 *
 * The view is `security_invoker = true`, so it returns exactly the rows the
 * caller could have read from the underlying tables directly. Pass the caller's
 * client, never a service-role one, or the guard answers a different question
 * from the one its call site is entitled to ask.
 */

/**
 * The subset of `gameIds` that has begun producing results.
 *
 * Batched — one request for the whole set, which is what the view is for. An
 * empty input short-circuits: PostgREST's `in.()` with no values is a request
 * that cannot match anything, so there is nothing to ask.
 *
 * Existence is read as ROWS rather than a `head: true` count because the caller
 * needs to know WHICH games started, not how many. The 1000-row cap that makes
 * row-collecting dangerous elsewhere in `participationGuard` cannot bite here:
 * the view is `SELECT DISTINCT`, so it returns at most one row per game and the
 * reply is bounded by the number of games on a trip.
 */
export async function startedGameIds(
  supabase: SupabaseClient,
  gameIds: string[]
): Promise<Set<string>> {
  if (gameIds.length === 0) return new Set();
  // Loud. A swallowed error here reads as "no game has started", which is the
  // permissive answer for every caller — a roster lock that unlocks, a course
  // lock that opens under recorded results. That is exactly the shape of the
  // `.from("matches")` landmine (CLAUDE.md #16), where a checked-but-ignored
  // error disabled cross-device sync for six weeks. Through `rowsOrThrow`
  // (#1474), so the failure is the family's retryable sentence rather than a
  // raw PostgREST message.
  const rows = rowsOrThrow(
    await supabase.from("game_started").select("game_id").in("game_id", gameIds),
    "scores"
  );
  return new Set(rows.map((r) => r.game_id as string));
}

/** Has ANY of these games begun producing results? */
export async function anyGameStarted(
  supabase: SupabaseClient,
  gameIds: string[]
): Promise<boolean> {
  return (await startedGameIds(supabase, gameIds)).size > 0;
}
