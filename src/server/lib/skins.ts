import type { SupabaseClient } from "@supabase/supabase-js";
import {
  tallySkins,
  computeSkinsStandings,
  skinsGloriousConfig,
  type SkinsOutcomeRow,
  type SkinsStanding,
} from "@/lib/skins";
import { computeStrokeTeamStandings } from "@/lib/strokePlay";
import { unitsFromSchema } from "@/lib/strokePlayConfig";
import { writeGameResults, type WriteFailureMode } from "./writeGameResults";

/**
 * DB-persist side of skins results — the wrapper over the pure engine, run on
 * Finish (CLAUDE.md #8: the rule is client-safe in `src/lib/skins.ts`, this
 * reads and commits).
 *
 * Two row kinds, one atomic replace, the same shape stroke play writes:
 *
 *   · `entity_type='user'`  — skins won per player, ranked over the WHOLE field.
 *   · `entity_type='team'`  — the roll-up, only when the game is in a
 *                             competition. Without it a finalized game
 *                             contributes NOTHING to the cup, because
 *                             `competitionLeaderboard` filters on
 *                             `entity_type='team'` — the exact hole stroke play
 *                             sat in until someone measured it.
 *
 * ── The roll-up is Stableford's, and it is reused rather than rewritten ────
 *
 * `computeStrokeTeamStandings` reads only `entityId` and `rawScore` off each
 * standing — no strokes, no par, no holes. It is a group-by-team, sum, rank, and
 * it is blind to what produced the number. So a skins standing rolls up through
 * it unchanged; the only thing skins has to supply is which DIRECTION wins, and
 * it passes its own `"skins"` rather than borrowing `"stableford"` to get
 * high-wins (see `ScoringType`).
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 *
 * No handicaps and no net derivation. A skins hole is recorded, not computed:
 * the group applies strokes in their heads and enters the winner, so there is
 * nothing to allot and no `strokedByPlayer`. That absence is the format, not an
 * omission.
 */
export async function computeSkinsResults(
  supabase: SupabaseClient,
  gameId: string,
  { onFailure }: { onFailure?: WriteFailureMode } = {}
): Promise<SkinsStanding[]> {
  const { data: game } = await supabase
    .from("games")
    .select("id, competition_id, game_type_id, modifiers, scorecard_schema")
    .eq("id", gameId)
    .maybeSingle();

  const holeCount = unitsFromSchema(game?.scorecard_schema).length || 18;
  const glorious = skinsGloriousConfig(
    game?.game_type_id as string | null,
    game?.modifiers as Record<string, Record<string, unknown>> | null
  );

  // TWO ROUNDS, unavoidably — a grouping's id is not knowable from the outcomes
  // alone, and a player's grouping is not knowable from the groupings alone.
  // CLAUDE.md #27's shape: the boundary is not a person and the person is not
  // the boundary.
  const [{ data: parts }, { data: outcomes }] = await Promise.all([
    supabase.from("game_participants").select("user_id, play_group_id").eq("game_id", gameId),
    supabase
      .from("skins_hole_outcomes")
      .select("grouping_id, hole_number, result, winner_user_id")
      .eq("game_id", gameId),
  ]);

  // Only GROUPED participants are in the game — migration 185's go-live gate
  // refuses a groupless skins game precisely because an ungrouped player has no
  // contest to be in.
  const participants = (parts ?? [])
    .filter((p) => p.play_group_id != null)
    .map((p) => ({ userId: p.user_id as string, groupingId: p.play_group_id as string }));

  const rowsByGrouping: Record<string, SkinsOutcomeRow[]> = {};
  for (const o of outcomes ?? []) {
    const gid = o.grouping_id as string;
    (rowsByGrouping[gid] ??= []).push({
      hole: o.hole_number as number,
      result: o.result as "won" | "tied",
      winnerId: (o.winner_user_id as string | null) ?? null,
    });
  }

  const groupingIds = [...new Set(participants.map((p) => p.groupingId))];
  const tallies = tallySkins(groupingIds, rowsByGrouping, holeCount, glorious);

  /**
   * ONLY PLAYERS WHOSE GROUPING HAS RECORDED SOMETHING ARE BANKED.
   *
   * This is a qualification step, and skipping it put points on a real cup
   * board. `computeSkinsStandings` gives every grouped participant a row — which
   * is right for the LIVE board, where a player yet to tee off shows a dash — but
   * banking those rows publishes N standings all on 0 skins and all at
   * `position: 1`. The leaderboard reads that as every team TIED FOR FIRST and
   * `placementPoints` averages the whole distribution across them, so a game
   * sitting in CONFIGURING paid out its entire pot evenly (5·5·5·5 of 20, seen
   * on BBMI 2025).
   *
   * It fires on the SETUP path rather than the finalize: `games.saveConfig`
   * recomputes after every settings Save, so merely configuring the game
   * published an awardable result.
   *
   * The rule is the one `StrokeTeamTotals` already states for its own board — "a
   * team with nobody playing yet gets NO row rather than a row totalling zero" —
   * applied to what is BANKED rather than what is drawn. Zero is a real score
   * here; not having played is not a score at all, and the two must not be
   * written the same way.
   *
   * `started` is per GROUPING, which is the honest unit: a hole is decided for
   * everyone in it at once, so a player on 0 in a grouping thru nine has
   * genuinely been beaten nine times and belongs in the standings.
   */
  const standings = computeSkinsStandings(participants, tallies).filter((s) => s.started);

  // Team aggregate — competition games only. A standalone game has no
  // `competition_id`, so `teamOf` stays empty and the roll-up returns [],
  // leaving the user-only shape identical to a standalone finalize.
  const teamOf: Record<string, string> = {};
  if (game?.competition_id) {
    const { data: assigns } = await supabase
      .from("team_assignments")
      .select("user_id, team_id")
      .eq("competition_id", game.competition_id as string);
    for (const a of assigns ?? []) teamOf[a.user_id as string] = a.team_id as string;
  }
  const teamStandings = computeStrokeTeamStandings(
    standings.map((s) => ({ entityId: s.entityId, rawScore: s.skins, position: s.position })),
    teamOf,
    "skins"
  );

  await writeGameResults(supabase, {
    gameId,
    scope: { kind: "all" },
    rows: [
      ...standings.map((s) => ({
        id: crypto.randomUUID(),
        entity_id: s.entityId,
        entity_type: "user" as const,
        raw_score: s.skins,
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
