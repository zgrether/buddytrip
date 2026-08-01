import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeStrokePlayStandings,
  computeStrokeTeamStandings,
  netStrokeEntries,
  type RawStrokeEntry,
  type StrokeStanding,
} from "@/lib/strokePlay";
import { strokeHoles } from "@/lib/matchPlay";
import { strokeIndexOf, unitsFromSchema } from "@/lib/strokePlayConfig";
import { writeGameResults, type WriteFailureMode } from "./writeGameResults";

/**
 * DB-persist side of stroke-play results (shape (b) — runs on Finish).
 *
 * Reads a game's participants + score entries, applies each player's handicap
 * as NET (a stroke comes off the holes `strokeHoles` allocates against the
 * game's course stroke index — the snapshot in `scorecard_schema`), computes
 * standings via the SHARED pure `computeStrokePlayStandings` (same rule the
 * live client strip uses — see `src/lib/strokePlay.ts`), and REPLACES the
 * game's `game_results` rows. Idempotent: a recompute deletes prior rows first.
 *
 * Writes TWO row kinds, in one atomic replace:
 *  - `entity_type='user'` — per-player net standings. Always.
 *  - `entity_type='team'` — TEAM AGGREGATE NET, only when the game belongs to a
 *    competition. Every player's net counts toward their team; lowest wins.
 *
 * The team half is new. This engine previously wrote user rows ONLY, and its own
 * doc comment said why — "standalone game". But `competitionLeaderboard` reads
 * `game_results` filtered `.eq("entity_type","team")`, so a finalized stroke game
 * in a competition contributed **nothing to the cup**: the finalize succeeded, the
 * board stayed empty, and nothing anywhere reported a problem. Rack
 * (`rackNStack.ts:122`) and match (`matchPlay.ts:250`) had always written team
 * rows; stroke was the format that never learned the competition half.
 *
 * `position` (rank, 1 = best) is the PLACEMENT shape the leaderboard's placement
 * branch reads, with the game's `points_distribution` supplying the payout — the
 * same contract rack uses for a non-per_match game. Points themselves stay
 * derived at roll-up; `competition_points_earned` stays null here.
 *
 * Net is derived through the shared `netStrokeEntries` helper so the persisted
 * final and the live strip can't diverge. `score_entries.value` stays raw
 * gross; a handicap-less game nets to gross unchanged. The live strip does NOT
 * call this — it derives net client-side (shape (a)); only Finish persists here.
 */
export async function computeStrokePlayResults(
  supabase: SupabaseClient,
  gameId: string,
  /** #776 — how a results-write failure surfaces. Defaults to the setup
   *  behaviour; `games.finish` passes "throw". See WriteFailureMode. */
  { onFailure }: { onFailure?: WriteFailureMode } = {}
): Promise<StrokeStanding[]> {
  const { data: participants } = await supabase
    .from("game_participants")
    .select("user_id, handicap_strokes")
    .eq("game_id", gameId);
  const { data: entries } = await supabase
    .from("score_entries")
    .select("participant_id, unit_label, value")
    .eq("game_id", gameId)
    .eq("participant_type", "user");
  const { data: game } = await supabase
    .from("games")
    .select("scorecard_schema, competition_id")
    .eq("id", gameId)
    .single();

  // Hole-stroke index from the game's course snapshot (sequential fallback when
  // no course is applied). Each player's stroked holes drive the gross→net.
  const strokeIndex = strokeIndexOf(unitsFromSchema(game?.scorecard_schema));
  const strokedByPlayer: Record<string, Set<string>> = {};
  for (const p of participants ?? []) {
    strokedByPlayer[p.user_id as string] = new Set(
      [...strokeHoles((p.handicap_strokes as number) ?? 0, strokeIndex)].map(String)
    );
  }

  const standings = computeStrokePlayStandings(
    (participants ?? []).map((p) => p.user_id as string),
    netStrokeEntries((entries ?? []) as RawStrokeEntry[], strokedByPlayer)
  );

  // Team aggregate net — competition games only. A standalone game has no
  // competition_id, so `teamOf` stays empty and `computeStrokeTeamStandings`
  // returns [], leaving the user-only shape byte-identical to before.
  const teamOf: Record<string, string> = {};
  if (game?.competition_id) {
    const { data: assigns } = await supabase
      .from("team_assignments")
      .select("user_id, team_id")
      .eq("competition_id", game.competition_id as string);
    for (const a of assigns ?? []) teamOf[a.user_id as string] = a.team_id as string;
  }
  const teamStandings = computeStrokeTeamStandings(standings, teamOf);

  // #776: one atomic replace instead of a bare delete + bare insert. Note there
  // is no early return above — an empty game legitimately clears its results, so
  // `rows: []` is a real "clear", not a no-op. That behaviour is preserved.
  //
  // Both row kinds go in the SAME `scope:"all"` replace. Match play needs two
  // scoped passes because it writes its user rows and team rows at different
  // points in the same finalize; stroke computes both from one pass, so a single
  // atomic replace is correct AND simpler — there is no window in which the user
  // rows exist without their team rows.
  await writeGameResults(supabase, {
    gameId,
    scope: { kind: "all" },
    rows: [
      ...standings.map((s) => ({
        id: crypto.randomUUID(),
        entity_id: s.entityId,
        entity_type: "user" as const,
        raw_score: s.rawScore,
        position: s.position,
        competition_points_earned: null,
      })),
      ...teamStandings.map((t) => ({
        id: crypto.randomUUID(),
        entity_id: t.teamId,
        entity_type: "team" as const,
        raw_score: t.total,
        position: t.position,
        competition_points_earned: null,
      })),
    ],
    onFailure,
  });
  return standings;
}
