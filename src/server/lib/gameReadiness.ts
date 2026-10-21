import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { isMatchesGame } from "@/lib/resultStrategy";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import { finishCapacityFor } from "@/lib/placeCapacity";
import {
  gameSetupReasons,
  goLiveGate,
  MATCH_PLAY_TYPES,
  pairedMatchCount,
  pairedMemberIds,
  PICKEM_TYPE,
  type SetupInput,
  type StoredMatchRow,
} from "@/lib/gameReadiness";
import { countOrThrow, maybeRowOrThrow, rowsOrThrow } from "./rowOrThrow";

/**
 * Game readiness, server half. The RULE is `gameSetupReasons` in
 * src/lib/gameReadiness.ts, shared with the board and every settings page; this
 * file reads its inputs from the database (`readSetupInput`), refuses an
 * under-configured enable (`assertGameReady`), and decides New vs Configuring
 * (`isNew`, below). The format's REQUIRED structure is the bar; course and
 * handicaps are optional and NEVER gate readiness.
 */

// The format-type sets live with the shared readiness rule (src/lib/gameReadiness.ts),
// which the browser imports too; re-exported so server callers keep their imports.
export { MATCH_PLAY_TYPES, RACK_TYPE, SCRAMBLE_TYPE, SKINS_TYPE, ROSTER_TYPES } from "@/lib/gameReadiness";

/**
 * A game's setup inputs, read from the database: the shape `gameSetupReasons`
 * takes, built from the same rows `save_game_config`'s go-live branch reads.
 * The enable guard below and the parity test both read through here, so the
 * server's answer and the database's are computed from one set of reads.
 *
 * Every read succeeds or throws (`rowOrThrow` family, #1468): a failed match
 * read must not become "no matches", and a failed roster read must not become
 * "everyone is on a team". Null when the game does not exist.
 */
export async function readSetupInput(supabase: SupabaseClient, gameId: string): Promise<SetupInput | null> {
  const game = maybeRowOrThrow(
    await supabase
      .from("games")
      .select("game_type_id, competition_format, competition_id, points_total, points_distribution")
      .eq("id", gameId)
      .maybeSingle(),
    "game"
  );
  if (!game) return null;
  const typeId = (game.game_type_id as string | null) ?? null;
  const competitionFormat = (game.competition_format as string | null) ?? null;
  const competitionId = (game.competition_id as string | null) ?? null;
  const matchShaped = (typeId != null && MATCH_PLAY_TYPES.has(typeId)) || isMatchesGame(typeId, competitionFormat);
  const none = Promise.resolve({ data: [] as never[], error: null, count: 0 });

  const [matchRes, partRes, entrantRes, slateRes, teamRes, assignRes] = await Promise.all([
    matchShaped ? supabase.from("game_matches").select("side_a, side_b").eq("game_id", gameId) : none,
    supabase.from("game_participants").select("user_id, play_group_id").eq("game_id", gameId),
    supabase.from("bracket_entrants").select("id", { count: "exact", head: true }).eq("game_id", gameId),
    typeId === PICKEM_TYPE
      ? supabase.from("pickem_slate_games").select("id", { count: "exact", head: true }).eq("game_id", gameId)
      : none,
    competitionId
      ? supabase.from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId)
      : none,
    competitionId ? supabase.from("team_assignments").select("user_id").eq("competition_id", competitionId) : none,
  ]);

  const matches = rowsOrThrow(matchRes, "game's matches") as StoredMatchRow[];
  const participants = rowsOrThrow(partRes, "game's players") as { user_id: string | null; play_group_id: string | null }[];
  const entrants = countOrThrow(entrantRes, "bracket's entrant count");
  const teamCount = competitionId ? countOrThrow(teamRes, "cup's team count") : 0;
  const teamed = new Set((rowsOrThrow(assignRes, "cup's rosters") as { user_id: string }[]).map((r) => r.user_id));

  return {
    gameTypeId: typeId,
    competitionFormat,
    inCompetition: competitionId != null,
    cupHasTeams: teamCount > 0,
    pointsTotal: (game.points_total as number | null) ?? null,
    pointsDistribution: (game.points_distribution as PointsDistribution | null) ?? null,
    matchesTotal: matches.length,
    matchesPaired: pairedMatchCount(matches),
    pairedPlayersOffTeam: pairedMemberIds(matches, participants).filter((id) => !teamed.has(id)).length,
    groupedPlayers: participants.filter((p) => p.play_group_id != null).length,
    bracketEntrants: entrants,
    placeCapacity: finishCapacityFor({
      entrantCount: entrants,
      teamCount,
      peopleCount: participants.filter((p) => p.user_id != null).length,
    }),
    slateGames: typeId === PICKEM_TYPE ? countOrThrow(slateRes, "slate's game count") : 0,
  };
}

/**
 * Server-side enable guard. Throws PRECONDITION_FAILED, naming the first thing
 * to fix, when `games.enableScoring` or `matches.enableScoring` would take a
 * game live that `save_game_config` would refuse. The same reasons the board
 * and the settings pages show (`gameSetupReasons`).
 */
export async function assertGameReady(supabase: SupabaseClient, gameId: string): Promise<void> {
  const input = await readSetupInput(supabase, gameId);
  if (!input) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  const { ready, blockedReason } = goLiveGate(gameSetupReasons(input));
  if (!ready) throw new TRPCError({ code: "PRECONDITION_FAILED", message: blockedReason ?? undefined });
}

/**
 * ── NEW vs CONFIGURING ────────────────────────────────────────────────────────
 *
 * `isConfigured` above answers "is this ready to SCORE?" — the Ready threshold,
 * unchanged by anything below. This answers a different and earlier question:
 * has anyone configured this game AT ALL, or does it still carry only what the
 * add-game modal wrote?
 *
 * It exists because the board's two setup labels were attached to a predicate
 * that means neither of them. `sectionOf` was `configured ? "preparing" :
 * "skeleton"` — rendered as "Configuring" and "New" — so:
 *
 *   • a fresh non-golf / manual / BRACKET game read CONFIGURING at the instant of
 *     creation, because `isConfigured`'s fallback arm is `hasPoints` and the
 *     add-game modal always writes a points sentinel (47/47 rows locally are
 *     non-null). It could never be New.
 *   • a golf game (match / stroke / rack) read NEW through course selection,
 *     points, modifiers, rules and tee time — anything short of a roster. A
 *     stroke game with a tee time and 8 points read "New".
 *
 * Measured on a staged board rather than reasoned about, and the measurement
 * corrected a claim made while deriving this: a BRACKET with a seeded field was
 * said to read "New", on the grounds that `isConfigured` is roster-gated and a
 * bracket has no `game_participants`. It does not — a bracket is not a
 * ROSTER_TYPE either, so it falls to the `hasPoints` arm and always read
 * Configuring. Its section is UNCHANGED by this module. The two defects above
 * are the real ones.
 *
 * So this is not a new state so much as a predicate that matches the two labels
 * already on screen.
 *
 * ── The partition, and why it is total ────────────────────────────────────────
 *
 * Derived from `GAME_CONFIG_COLS` (games.ts) rather than hand-written, per
 * CLAUDE.md #27 — go read the list that already defines what configuration means
 * instead of inventing a second one. Every column of that list is in exactly one
 * of the three sets below, and `gameStateCoverage.test.ts` asserts the union is
 * total against the LIVE schema, so a new column trips CI until someone
 * classifies it. That is the same mechanism `configHash.coverage.test.ts` uses,
 * and it is the durable half of this change: without it the classification drifts
 * the moment a migration adds a column.
 */

/** What the game IS. Written by the add-game modal; says nothing about setup.
 *  `competition_id` joined the hashed columns in migration 218 (a save can now
 *  take a game OUT of its competition). It is what the game counts toward,
 *  chosen at creation, and leaving a cup is not configuring the game, so a
 *  game still reads New afterwards if nothing else was set. */
export const IDENTITY_COLS = ["name", "game_type_id", "competition_id"] as const;

/**
 * CLAUDE.md #25's separate lifecycle axis. `sectionOf` already branches on
 * `status` before it ever asks this question, and the other three move on
 * go-live rather than on configuration.
 */
export const LIFECYCLE_COLS = [
  "status",
  "scoring_enabled",
  "corrections_open",
  "pairings_published_at",
] as const;

/**
 * Has this column departed from the value a freshly-created game carries?
 *
 * One predicate per column rather than a deep-equal against a defaults object,
 * because "the creation value" is not the same thing as "the column default" for
 * the two points columns — see below. Writing it per-column makes that visible
 * instead of hiding it in an exception branch.
 */
export const CONFIG_COL_DEPARTED: Record<string, (v: unknown) => boolean> = {
  // jsonb, DEFAULT '{}' — an empty object is untouched.
  config: (v) => notEmptyObject(v),
  modifiers: (v) => notEmptyObject(v),
  bracket_config: (v) => notEmptyObject(v),
  // Plain nullable columns: any value at all is a configuration act.
  rules_for_today: (v) => v != null,
  scorecard_schema: (v) => v != null,
  tee_time: (v) => v != null,
  competition_format: (v) => v != null,
  course_id: (v) => v != null,
  back_course_id: (v) => v != null,
  // DEFAULT 'score' — a game only leaves it by being switched to outcome entry.
  entry_mode: (v) => v != null && v !== "score",
  /**
   * THE TWO THAT ARE NOT THEIR DEFAULT.
   *
   * Both columns default to NULL, but `games.create` never leaves them there:
   * the add-game modal writes `points_total: 0` for placement formats and
   * `{type:'per_match', value: 0}` for match play — the #503 sentinel whose whole
   * job is to keep the Enable gate shut until someone sets a real number. So
   * non-null is true of every game ever created and carries no signal at all.
   *
   * A POSITIVE value is the departure. That is not a special case invented here:
   * `OuterColumn` renders on `pts != null && pts > 0` and migration 093's enable
   * gate refuses `COALESCE(points_total, 0) <= 0`, so the board and the server
   * already read points this way. (`isConfigured` does not, which is a real
   * disagreement and is filed as #1029 rather than fixed here — folding a
   * threshold change into a labelling change would bury it.)
   *
   * The happy consequence: a New game shows `—` in the points column by
   * construction, because the only surface that can set a positive value is the
   * settings page. New and a visible point value are mutually exclusive with no
   * gate needed.
   */
  points_total: (v) => typeof v === "number" && v > 0,
  points_distribution: (v) => distributionHasValue(v),
};

function notEmptyObject(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v !== "object") return true;
  return Object.keys(v as object).length > 0;
}

/**
 * Does this game carry a POSITIVE point value? The ONE answer to "has points"
 * (#1029), for `isConfigured`'s last arm, the enable guard and the board.
 *
 * It used to be "is either column non-null". The add-game modal writes
 * `points_total: 0` (or `{type:'per_match', value: 0}`) on every create, the
 * #503 sentinel, so non-null was true of every game from the moment it
 * existed: a fresh non-golf game read Configuring ("Ready — enable scoring")
 * while migration 093's gate refused the enable on `points_total <= 0`. The
 * row promised a button the server refused. Positive is what the gate, the
 * board's points column and `CONFIG_COL_DEPARTED` already read, so this is
 * the same definition (`distributionHasValue`), now shared.
 */
export function hasPositivePoints(row: { points_total?: unknown; points_distribution?: unknown }): boolean {
  return (typeof row.points_total === "number" && row.points_total > 0) || distributionHasValue(row.points_distribution);
}

/** A points distribution carries a real value: a positive per-match number, or a
 *  placement split with anything positive in it. */
function distributionHasValue(v: unknown): boolean {
  if (v == null || typeof v !== "object") return false;
  const d = v as { type?: unknown; value?: unknown; values?: unknown };
  if (d.type === "per_match") return typeof d.value === "number" && d.value > 0;
  if (d.type === "placement") {
    return Array.isArray(d.values) && d.values.some((n) => typeof n === "number" && n > 0);
  }
  // An unrecognised shape is content somebody wrote — treat it as departed rather
  // than silently reading as untouched.
  return Object.keys(d).length > 0;
}

/**
 * The games-row half of the question: has any CONFIG column been written?
 *
 * An ABSENT column counts as touched. This is the fail-safe direction, and it is
 * deliberate: callers pass a row from a `select` that names its columns, and a
 * `select` missing one would otherwise make `row[col]` `undefined`, every
 * predicate return false, and the game read NEW — silently, and most wrongly for
 * the games that are most configured. "Not New" is the old behaviour, so failing
 * that way degrades to the status quo instead of inventing a new lie.
 *
 * It is a backstop, not the mechanism: `gameStateCoverage.test.ts` asserts the
 * leaderboard's select covers every key here, so in a correct build this branch
 * never fires. It exists because the alternative failure is invisible (CLAUDE.md
 * #16's landmine — a swallowed absence folded into every answer).
 */
export function gameRowTouched(row: Record<string, unknown>): boolean {
  return Object.entries(CONFIG_COL_DEPARTED).some(
    ([col, departed]) => !(col in row) || departed(row[col])
  );
}

/**
 * Is this game still carrying ONLY identity — nothing configured yet?
 *
 * `childRowCount` is the number of rows this game has in the configuration child
 * tables (`game_participants`, `play_groups`, `game_matches`, `bracket_entrants`,
 * `bracket_matches`). Any row in any of them is a configuration act. The caller
 * passes a count rather than this module querying, so the leaderboard reuses the
 * counts it already computes for `isConfigured` instead of adding a round trip.
 *
 * `game_delegates` is deliberately NOT counted. A delegate is chosen in the
 * add-game modal alongside the name and the format — it says who RUNS the game,
 * not how it is played — so counting it would give a game created with a delegate
 * no reachable New state, reintroducing the exact defect this replaces for a
 * subset of games.
 *
 * NOT stored. Derived on read, like every other readiness signal here.
 */
export function isNew(row: Record<string, unknown>, childRowCount: number): boolean {
  if ((row.status as string | null) !== "pending") return false;
  return childRowCount === 0 && !gameRowTouched(row);
}
