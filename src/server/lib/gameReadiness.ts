import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";
import { matchPlayReady } from "@/lib/matchDraft";

/**
 * Game readiness — the ONE "is this game configured enough to score?" signal,
 * shared (A2-core) by the competition leaderboard's Setting-up↔Ready display AND
 * the server-side enable guard (`assertGameReady`). Lifted out of
 * competitionLeaderboard.ts so the mode toggle's Setup→Scoring flip is refused
 * server-side for an under-configured game, for ALL three formats — not just the
 * client gate match play had. The format's REQUIRED roster is the bar; course +
 * handicaps are optional and NEVER gate readiness.
 */

// One unified match-play type (Refactor A1) — 1v1/2v2/mixed is per-match, not a
// game type. A Set is kept (rather than an equality) so any future match-play
// variant slots in without touching call sites.
export const MATCH_PLAY_TYPES = new Set(["gtt_match_play"]);
export const RACK_TYPE = "gtt_rack_n_stack";
// Roster-gated golf formats: both stroke and rack are "configured" once they have
// participants assigned to a PLAYING GROUP (the manual group builder). Groupings are
// MANDATORY for both (089) — an ungrouped player isn't in the game — so the caller
// passes the GROUPED participant count (see the grouped-count branch below).
export const ROSTER_TYPES = new Set(["gtt_stroke_play", RACK_TYPE]);

/**
 * Is the game configured enough to be Ready (vs still Setting up)?
 *  - match play → ALL pairings assigned (`matchPlayReady`: paired === total, ≥1) —
 *    the SAME threshold the setup-page Enable gate uses, so list-ready ⟺
 *    setup-can-enable (readiness rework P1b).
 *  - stroke / rack → participants assigned to a PLAYING GROUP (the manual group
 *    builder); groupings are MANDATORY for both (089), so the caller passes the
 *    GROUPED participant count — ungrouped players (not in the game) don't read as ready
 *  - manual / side events → points configured (no roster to assign)
 */
export function isConfigured(
  typeId: string | null,
  matchPaired: number,
  matchTotal: number,
  participantCount: number,
  hasPoints: boolean
): boolean {
  if (typeId && MATCH_PLAY_TYPES.has(typeId)) return matchPlayReady(matchPaired, matchTotal);
  if (typeId && ROSTER_TYPES.has(typeId)) return participantCount > 0;
  return hasPoints;
}

/**
 * Server-side enable guard (A2-core, decision 4). Throws PRECONDITION_FAILED if the
 * game isn't configured enough to switch to scoring. The client toggle is gated too
 * (UX), but THIS is the enforcement — and it covers stroke/rack/manual, which had no
 * client gate at all. Reads the same inputs the leaderboard derives `configured` from.
 */
export async function assertGameReady(supabase: SupabaseClient, gameId: string): Promise<void> {
  const { data: game } = await supabase
    .from("games")
    .select("game_type_id, points_distribution, points_total")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

  const typeId = (game.game_type_id as string | null) ?? null;
  const hasPoints = game.points_distribution != null || game.points_total != null;
  let matchPaired = 0;
  let matchTotal = 0;
  let participantCount = 0;

  if (typeId && MATCH_PLAY_TYPES.has(typeId)) {
    const { data: rows } = await supabase
      .from("game_matches")
      .select("side_a, side_b")
      .eq("game_id", gameId);
    const matches = (rows ?? []) as { side_a: { id?: string } | null; side_b: { id?: string } | null }[];
    matchTotal = matches.length;
    matchPaired = matches.filter((m) => m.side_a?.id && m.side_b?.id).length;
  } else if (typeId && ROSTER_TYPES.has(typeId)) {
    let query = supabase
      .from("game_participants")
      .select("user_id", { count: "exact", head: true })
      .eq("game_id", gameId);
    // Both stroke and rack require players actually GROUPED (the manual group builder) —
    // a bare roster with no playing groups isn't ready (mandatory groupings, 089).
    query = query.not("play_group_id", "is", null);
    const { count } = await query;
    participantCount = count ?? 0;
  }

  if (!isConfigured(typeId, matchPaired, matchTotal, participantCount, hasPoints)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Finish setting up this game before switching it to scoring.",
    });
  }
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

/** What the game IS. Written by the add-game modal; says nothing about setup. */
export const IDENTITY_COLS = ["name", "game_type_id"] as const;

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
