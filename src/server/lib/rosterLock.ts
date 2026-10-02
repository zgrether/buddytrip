import type { SupabaseClient } from "@supabase/supabase-js";
import { anyGameStarted } from "./gameStarted";
import { rowsOrThrow } from "./rowOrThrow";

/**
 * Has a competition got RESULTS — the moment captains lose roster rights
 * (ruling 29, `_competition_roster_locked` in SQL), individuals-or-teams locks
 * (ruling 23, `teams.create`), the cup reads as underway in its settings, and a
 * staff roster change starts needing a reviewed preview (`rosterChange.ts`).
 *
 * ── This was the roster LOCK, and PR 8b lifted it ─────────────────────────
 *
 * Until 8b it refused every Organizer move, removal and team delete once a cup
 * had a result, and it was named for that (`assertRosterUnlocked`, the
 * `rosterLocked` query). It was also, without saying so, the only thing keeping
 * a trade from re-crediting a finished game through the new roster — which 8a
 * fixed at the writers (`games.credited_roster`). With the lock gone the names
 * would have been a small false statement read by everyone touching the code,
 * so the predicate is named for what it answers.
 *
 * ── The signal was `score_entries` and that was wrong for three formats ────
 *
 * It used to count `score_entries` rows directly. Three formats write none —
 * outcome-mode match play (`match_hole_outcomes`), pick'em
 * (`pickem_slate_games.result`), and non-golf Matches (a declared
 * `game_matches.result`) — so it read a cup well underway as untouched (#1018).
 * `game_started` is the boundary with every format's arm in it; see
 * `gameStarted.ts` for why the predicate is shared rather than copied.
 *
 * Known gaps, tracked rather than re-decided here: manual placements (#1525)
 * and the bracket (#1413) are not yet in `game_started`.
 */

/** Has ANY game in this competition begun producing results? */
export async function competitionHasResults(
  supabase: SupabaseClient,
  competitionId: string,
): Promise<boolean> {
  // #1469: a failed read must not become "this cup has no games" — an empty id
  // list reads as nothing started, and the lock OPENS on a scored cup.
  // (`startedGameIds` below already refuses its own failures.)
  const games = rowsOrThrow(
    await supabase.from("games").select("id").eq("competition_id", competitionId),
    "cup's games"
  );
  const ids = games.map((g) => g.id as string);
  return anyGameStarted(supabase, ids);
}
