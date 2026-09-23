import type { SupabaseClient } from "@supabase/supabase-js";
import { rollUp, placementDetail, placementPoints, awardedForGame, type LiveGame } from "@/lib/competitionPlacement";
import { isPerMatch, isPlacement, effectiveDistribution, payingSchedule, type PointsDistribution } from "@/lib/pointsDistribution";
import { teamPointsFromEntrants } from "@/lib/bracketPlacements";
import { isBracketGame, isPickemGame, isMatchesGame } from "@/lib/resultStrategy";
import { deriveMatchCount, type MatchFormat } from "@/lib/gameConfig";
import { projectedTeamTotals } from "@/lib/gameProjection";
import { isManualGameType, type ScoringModel } from "@/lib/gameTypes";
// isConfigured (+ the type sets) moved to gameReadiness.ts (A2-core) so the same
// "is it configured?" signal backs both this display AND the server enable guard.
import { isConfigured, isNew, MATCH_PLAY_TYPES, RACK_TYPE, ROSTER_TYPES } from "@/server/lib/gameReadiness";
import { pointsDivideByMatchRows } from "@/lib/pointsDistribution";
import { computeLiveProjections, type LiveProjectionInput } from "@/server/lib/liveProjection";

/** Head-to-head sizing for the team-size-derived per_match formats (rack-n-stack,
 *  whose slots are always 1v1). Match play itself counts its configured
 *  `game_matches` rows (`matchCountByGame`), never this path — and the standalone
 *  doubles game type was unified away (Refactor A1), so there is no game-level
 *  "doubles" left to size. Kept as a stable seam for `deriveMatchCount`. */
function matchFormat(_gameTypeId: string | null): MatchFormat {
  return "singles";
}

/**
 * THE CONVENTION, CARRIED TO THE RANKING (#1245 → #1381).
 *
 * A team `game_results` row carries its value in one of two fields, and they
 * rank OPPOSITE ways: `position` is a RANK (`low_wins`), `raw_score` is POINTS
 * already decided (`high_wins`). For months those were folded into one number
 * with `position ?? raw_score`, and every arm below chose a `direction` on its
 * own. They disagreed twice, both times paying a cup's pot to the side that won
 * LEAST: #1245 in the winner-take-all arm (a Matches game's points read as
 * positions), and #1381 in the `isPlacement` arm directly below it (BBMI 2026
 * Cornhole: won 3 of 4, board paid 8–0 the other way). The first fix patched one
 * arm; the second bug was the same collapse in the next.
 *
 * So the rows' convention now travels with the standings, and this is the ONE
 * place that turns it into a ranking — whichever arm a game lands in:
 *
 *  - rows carry POINTS → the points ARE the award. Ranked `high_wins` and passed
 *    through as the synthetic distribution (the mechanism the `per_match`,
 *    pick'em and bracket arms already use). A placement split on such a game
 *    describes a payout no finalize wrote, so it cannot re-rank points into it.
 *  - rows carry POSITIONS → a ranking to pay by the game's schedule. Ranked
 *    `low_wins` against the arm's schedule, or — when the arm expected points
 *    and authors none — `effectiveDistribution` (the game's split, else winner
 *    takes the total, the default every format uses).
 *  - rows MIXED → a write nobody can interpret. Pays nothing and keeps its pool.
 *
 * ── Since 3b, the arms no longer choose ─────────────────────────────────────
 * Up to #1381 the arms still picked a `direction` and a `distribution` and this
 * function overrode them when the rows disagreed. Those two were always one bit
 * (high_wins ⟺ as-scored, low_wins ⟺ schedule), and the bit is the ROW's. So a
 * team arm now returns a `TeamArm` — what its configuration `expects`, and the
 * `schedule` it authors — and the ranking comes from the declaration alone. The
 * report below compares the declaration against `expects`, which is sourced
 * from configuration and never from the rows; see `TeamArm` for why that
 * separation is the whole of what keeps it able to fire.
 *
 * ── When it has to override an arm, it SAYS so ──────────────────────────────
 * Production rows all agree with their arms today (measured 2026-09-17: every
 * position-row game ranks low_wins, every points-row game high_wins, none
 * mixed), so a reconciliation means a game is configured against its own
 * results. That is worth a log line with the values in it — but not a throw: the
 * ranking below is now CORRECT, and blanking a board to report a bug that has
 * been handled would cost more than the report. Mixed rows are the exception —
 * nothing correct can be computed, so they throw outside production and log in
 * it, as the old invariant did.
 */
export type RowConvention = "positions" | "points" | "mixed" | "conflicted";

/**
 * What the rows CONTAIN — the original reading, unchanged.
 *
 * `position`-only on purpose: `writeManualResults` and pick'em's placement arm
 * both MIRROR a rank into `raw_score`, so a test involving `raw_score` would
 * classify every manual placement as points. (Measured on production
 * 2026-09-22: 26 of 30 non-golf team rows carry both columns.)
 */
export function rowConvention(rows: { position: number | null }[]): RowConvention {
  const withPosition = rows.filter((r) => r.position != null).length;
  if (withPosition === rows.length) return "positions";
  if (withPosition === 0) return "points";
  return "mixed";
}

/**
 * What the rows DECLARE — `game_results.value_kind`, stamped by the writer at
 * finalize (migration 191, #826).
 *
 * `"undeclared"` is not a fourth convention: the column is NOT NULL, so it can
 * only mean a row reached this read without one, which the schema says is
 * impossible. Kept, and kept distinct from `"mixed"`, because "the schema says
 * this cannot happen" is a claim about the schema and not about the row in
 * front of you — a hand-edited row, a restored backup, or a writer added
 * against an older database all produce it, and silently inferring a value for
 * such a row is exactly the guess this column removed.
 */
export function declaredConvention(
  rows: { valueKind: string | null }[]
): RowConvention | "undeclared" {
  if (rows.length === 0) return "undeclared";
  const kinds = new Set(rows.map((r) => r.valueKind));
  if (kinds.size > 1) return "mixed";
  const only = [...kinds][0];
  if (only === "rank") return "positions";
  if (only === "points") return "points";
  return "undeclared";
}

/**
 * The reading the ranking uses, and the report when the two disagree.
 *
 * **The declaration wins where there is one.** That is the whole point of
 * storing it: the row says what it carries rather than the board guessing from
 * which column is null.
 *
 * **A disagreement ranks NOTHING, like `mixed`** — and for the same reason. A
 * row declaring points while carrying a position does not contain a number the
 * declaration knows how to read; ranking it either way picks one of two
 * mutually exclusive stories about the same game. It gets its OWN state and its
 * own message rather than being folded into `mixed`, because "the rows disagree
 * with each other" and "a row disagrees with itself" send a reader to different
 * places, and a widened condition under an unchanged message is how a refusal
 * starts naming the wrong object.
 *
 * **This cannot currently fire, and that is stated rather than assumed.** Every
 * one of the eight writers stamps the kind its own columns take — checked one
 * by one while adding them — and the 191 backfill derived it from those same
 * columns, so declared and contained agree on every production row by
 * construction. What it guards is the NEXT writer.
 */
export function resolveConvention(
  gameId: string,
  declared: RowConvention | "undeclared",
  contained: RowConvention
): RowConvention {
  if (declared === "undeclared") {
    console.warn(
      `[leaderboard] result rows carry no value_kind: game ${gameId} has team results written ` +
        `without the declaration migration 191 makes NOT NULL. Falling back to reading the columns ` +
        `(${contained}). This should be unreachable — check for a writer that bypasses ` +
        `write_game_results / writeManualResults.`
    );
    return contained;
  }
  if (declared !== contained) {
    console.error(
      `[leaderboard] result rows contradict their own declaration: game ${gameId} declares ` +
        `${declared} but its columns read ${contained} — awarding nothing, because neither ` +
        `ranking is sound. One of the two is a writer bug; the row is the evidence.`
    );
    return "conflicted";
  }
  return declared;
}

/**
 * What a TEAM arm knows from the game's CONFIGURATION — and nothing else (3b).
 *
 * An arm used to return a `direction` and a `distribution`, and it chose both.
 * They are one bit, not two: in all seven arms `high_wins` came with the sorted
 * values as the distribution (points passed through as scored), and `low_wins`
 * came with a schedule (ranks paid by place). And the bit belongs to the ROW —
 * a position is a rank, a raw_score is points already decided — which the row
 * now declares itself (`value_kind`, migration 191). So an arm no longer
 * chooses it. It says two things only its configuration can say:
 *
 *  - `expects` — what this game's configuration implies its rows carry. Read
 *    off the arm's own branch condition (distribution shape, scoring model,
 *    whether match rows exist).
 *  - `schedule` — for an arm expecting POSITIONS, the payout its configuration
 *    authors for ranks. Each arm keeps its own: `[total, 0]` for
 *    winner-takes-all is NOT normalised to `effectiveDistribution`'s `[total]`,
 *    because no one has measured that the two pay a tie the same.
 *
 * `reconcileConvention` then turns the row's declaration into the ranking.
 *
 * ── `expects` MUST NEVER BE COMPUTED FROM THE ROWS ─────────────────────────
 * That is the whole of what keeps the reconciler able to fire. Derive `expects`
 * from `value_kind` (or from `conventionByGame`) and every game agrees with
 * itself by construction: payouts stay correct, the suite's payout cases stay
 * green, and the one signal that a game is configured against its own results
 * — the signal that caught Cornhole — goes silent for good. Measured before
 * 3b was built: that build fails exactly two tests, the two warning assertions
 * in `competitionLeaderboard.convention.test.ts`, and nothing else.
 */
export type TeamArm = Omit<LiveGame, "direction" | "distribution"> &
  ({ expects: "positions"; schedule: number[] | null } | { expects: "points" });

/**
 * The ONE place a team game's ranking is decided — from the rows' declaration —
 * and the report when that declaration disagrees with what the game's
 * configuration expected (`arm.expects`).
 */
export function reconcileConvention(
  arm: TeamArm,
  convention: RowConvention | undefined,
  ctx: { competitionId: string; rawDistribution: PointsDistribution | null; pointsTotal: number | null }
): LiveGame {
  // The direction the configuration implies. Carried into the evidence as
  // `armDirection` so the logged shape stays byte-identical to the lines already
  // written before 3b — the Cornhole investigation matched fixture evidence
  // against live Vercel logs, and a renamed key would end that comparability.
  const armDirection = arm.expects === "points" ? ("high_wins" as const) : ("low_wins" as const);
  // Named, not spread: a spread would carry `expects`/`schedule` into the
  // LiveGame and on into everything downstream of the roll-up.
  const base = { id: arm.id, numTeams: arm.numTeams, standings: arm.standings, pointsTotal: arm.pointsTotal };
  // A schedule that PAYS NOTHING is no schedule (#1410). Collapsed HERE, at the
  // seam every positions arm passes through, rather than in the arm that was
  // caught doing it: pick'em's `[]` for a game worth nothing, placement's
  // values, a stroke total of 0 saved as `[0]`, and any arm written later all
  // reach the board through the two returns below.
  const schedule = payingSchedule(
    arm.expects === "positions"
      ? arm.schedule
      : // An arm expecting points authors no schedule; ranks reaching it are
        // paid by the game's split, else winner takes the total.
        effectiveDistribution(ctx.rawDistribution, ctx.pointsTotal)
  );

  // No standings to rank: the pre-decision shape. An arm expecting positions
  // still carries its schedule, because the schedule's sum is its
  // points-in-play when no owner total is set.
  if (arm.standings.length === 0) {
    return arm.expects === "positions"
      ? { ...base, distribution: schedule, direction: "low_wins" }
      : { ...base, distribution: null, direction: "high_wins" };
  }
  // Standings exist only where team rows do, so every game reaching here has a
  // convention. Absent one, nothing contradicts the configuration — and taking
  // `arm.expects` here is the ONLY place it may stand in for the rows.
  const declared: RowConvention = convention ?? arm.expects;

  const evidence = (to: string) =>
    JSON.stringify({
      competitionId: ctx.competitionId,
      gameId: arm.id,
      convention: declared,
      armDirection,
      rankedAs: to,
      standings: arm.standings.map((s) => ({ entityId: s.entityId, value: s.value })),
      distribution: ctx.rawDistribution,
      pointsTotal: ctx.pointsTotal,
    });

  if (declared === "mixed") {
    const message =
      `[leaderboard] ranking-convention unreadable: game ${arm.id} has team results carrying BOTH ` +
      `positions and raw_score points, so neither ranking is sound — awarding nothing. Evidence: ${evidence("nothing")}`;
    if (process.env.NODE_ENV === "production") console.error(message);
    else throw new Error(message);
    return { ...base, distribution: null, standings: [], direction: armDirection };
  }

  /**
   * Same OUTCOME as mixed, different FACT — and the message has to say which.
   * `mixed` is rows disagreeing with each other; this is a row disagreeing with
   * itself, which points at the writer rather than at the game's configuration.
   * `resolveConvention` has already logged the specific contradiction; this is
   * the ranking half of it.
   */
  if (declared === "conflicted") {
    const message =
      `[leaderboard] ranking-convention contradicted: game ${arm.id}'s team results declare one ` +
      `value_kind and carry the other, so neither ranking is sound — awarding nothing. Evidence: ${evidence("nothing")}`;
    if (process.env.NODE_ENV === "production") console.error(message);
    else throw new Error(message);
    return { ...base, distribution: null, standings: [], direction: armDirection };
  }

  // Rows carry POINTS → the points ARE the award: ranked high_wins and passed
  // through as the synthetic distribution. Whatever the configuration expected.
  if (declared === "points") {
    if (arm.expects === "positions") {
      console.warn(
        `[leaderboard] ranking-convention reconciled: game ${arm.id}'s results are raw_score POINTS but its ` +
          `arm ranks low_wins — paying the points as scored. The game's configuration disagrees with its ` +
          `results. Evidence: ${evidence("points")}`
      );
    }
    const sorted = [...arm.standings].sort((a, b) => b.value - a.value);
    return { ...base, distribution: sorted.map((s) => s.value), standings: sorted, direction: "high_wins" };
  }

  // Rows carry POSITIONS → a ranking, paid by the schedule.
  if (arm.expects === "points") {
    console.warn(
      `[leaderboard] ranking-convention reconciled: game ${arm.id}'s results are POSITIONS but its arm ` +
        `ranks high_wins — paying by place. The game's configuration disagrees with its results. ` +
        `Evidence: ${evidence("positions")}`
    );
  }
  return { ...base, distribution: schedule, direction: "low_wins" };
}

/**
 * Server roll-up wrapper (Slice D1 §5/§6). The DB-read half of the CLAUDE.md #8
 * split: it gathers live games + team standings, then defers ALL math to the
 * client-safe pure `rollUp` — so the leaderboard the crew sees and any persisted
 * total can't diverge.
 *
 * Standings spine:
 *  - placement games: game_results entity_type='team', position=rank (1=best),
 *    direction low_wins. Distribution values are the ranked payout array.
 *  - per_match games: game_results entity_type='team', raw_score=match points
 *    (written by the adapter in computeMatchPlayResults). No position. We build a
 *    SYNTHETIC distribution (sorted actual points) so rollUp's placementPoints
 *    passes the values through directly (direction high_wins).
 *
 * The win number is DERIVED here from the competition's games, never stored.
 */
export async function computeCompetitionLeaderboard(
  supabase: SupabaseClient,
  competitionId: string
) {
  // These reads are independent — run them in parallel (one round-trip's worth
  // of latency instead of stacked). `game_results` + the match counts alone
  // depend on the game ids, so they wait below.
  const [teamsRes, compRes, gameRowsRes, assignmentsRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name, color")
      .eq("competition_id", competitionId),
    supabase
      .from("competitions")
      .select("defending_team_id, scoring_model")
      .eq("id", competitionId)
      .maybeSingle(),
    // Games of this competition — all feed the roll-up.
    supabase
      .from("games")
      // `corrections_open` rides here so the board can flag a game that has been
      // re-opened for a correction. It was NOT selected before — #838 found the
      // board had no way to know, for any role, and that is why a game in review
      // read on the leaderboard exactly like a settled one.
      //
      // Note this contradicts a parenthetical in CLAUDE.md #10 ("carried on the
      // board's GameRow"). That is true of `games.listByTrip`, which selects `*`
      // and feeds different consumers; it was never true of THIS payload, which
      // names its columns. The invalidation advice in #10 is unaffected.
      // `competition_format` rides here because a game's scoring engine is
      // resolved from the game type AND it (`resolveResultStrategy`) — a bracket
      // is not a game type, so `game_type_id` alone stopped answering "how is
      // this game awarded?". Free: this select already names its columns.
      // The remaining CONFIG columns (`config`, `modifiers`, `bracket_config`,
      // `rules_for_today`, `scorecard_schema`, `tee_time`, `back_course_id`) ride
      // here for `isNew`. They are NOT optional extras: `isNew` reports "not New"
      // for any config column it cannot see, so omitting one would quietly restore
      // the old always-Configuring answer for every game. `gameStateCoverage.test.ts`
      // asserts this select carries every column the predicate reads.
      //
      // `scorecard_schema` is the largest of them and is the one that would be
      // tempting to leave out — it is also load-bearing. `games.clearCourse` nulls
      // `course_id` but leaves the format's base schema behind, so it is the ONLY
      // column that still says "this game was configured" after a course is removed.
      .select("id, name, points_distribution, points_total, status, game_type_id, competition_format, course_id, back_course_id, scoring_enabled, entry_mode, corrections_open, display_order, config, modifiers, bracket_config, rules_for_today, scorecard_schema, tee_time")
      .eq("competition_id", competitionId)
      // ONE global order for the whole board (migration 108). Every lifecycle
      // section sorts by this, which is what makes a game keep its place as it
      // moves Ready -> Live -> Completed instead of being re-sorted by arrival.
      //
      // `nullsFirst: false` and the created_at tiebreak together are the reason
      // `display_order` can be nullable: a game the backfill missed, or one
      // created by a path that forgot to number it, sorts to the BOTTOM in
      // creation order rather than vanishing or jumping to the top.
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    // Team sizes drive the team-size-derived per_match formats (rack-n-stack):
    // value × min team size. Match play instead counts its configured rows.
    supabase
      .from("team_assignments")
      .select("team_id")
      .eq("competition_id", competitionId),
  ]);
  const teams = teamsRes.data;
  const teamIds = (teams ?? []).map((t) => t.id as string);
  const comp = compRes.data;
  // Scoring-model axis (independent of team count; default match_play). Branches
  // ONLY the non-golf result award below — the hero stays on teams.length.
  const scoringModel = ((comp?.scoring_model as string | null) ?? "match_play") as ScoringModel;
  // A NON-GOLF MANUAL game (result_strategy NULL) vs a golf game — sourced from
  // the format definitions in code (W-PERF-01), no longer a DB template fetch.
  // Only manual games get the match-play winner-take-all award; golf untouched.
  const isManualType = (typeId: string | null) => isManualGameType(typeId);
  const allGames = gameRowsRes.data ?? [];
  const sizeByTeam = new Map<string, number>();
  for (const a of assignmentsRes.data ?? []) {
    const tid = a.team_id as string;
    sizeByTeam.set(tid, (sizeByTeam.get(tid) ?? 0) + 1);
  }
  const teamSizes = teamIds.map((id) => sizeByTeam.get(id) ?? 0);

  const gameIds = allGames.map((g) => g.id as string);
  /**
   * The competition's BRACKET games — resolved the same way `games.finish`
   * resolves what to compute, so the write path and this read path cannot
   * disagree about which games are brackets.
   *
   * Used to gate the `bracket_entrants` read below. A competition with no
   * bracket (every competition until now) issues exactly the queries it always
   * did — the roll-up costs a round trip only where there is something to roll
   * up, which matters because this payload is on the board's poll.
   */
  const bracketGameIds = allGames
    .filter((g) => isBracketGame(g.game_type_id as string | null, g.competition_format as string | null))
    .map((g) => g.id as string);
  // game_results (awarded) + the per-game match COUNT (available) + the per-game
  // participant COUNT (the stroke/rack readiness gate) + the per-game SCORE-entry
  // presence (the On-Tap↔Ready-for-Play split) + a bracket's entrant→team map.
  // All depend on the live game ids; run them together.
  const [resultsRes, matchRowsRes, participantRowsRes, startedRowsRes, entrantRowsRes] = await Promise.all([
    gameIds.length
      ? supabase
          .from("game_results")
          // `entity_type` is now SELECTED and the filter is a set, because a
          // bracket's results name entrants rather than teams (migration 119).
          // Splitting the rows by type below is what keeps a bracket's entrant
          // placements out of another game's team standings and vice versa —
          // reading them as one list would rank entrant ids against team ids.
          // `value_kind` is what the row DECLARES it carries and
          // `credited_team_id` is who it pays — both stamped at finalize
          // (migration 191). They replace two derivations that used to happen
          // here on every poll: guessing the convention from column nullness,
          // and resolving a bracket entrant's team through
          // `bracket_entrants.team_id` as it stands NOW.
          .select("game_id, entity_id, entity_type, position, raw_score, value_kind, credited_team_id")
          .in("game_id", gameIds)
          .in("entity_type", ["team", "entrant"])
      : Promise.resolve({ data: [] as { game_id: string; entity_id: string; entity_type: string; position: number | null; raw_score: number | null; value_kind: string | null; credited_team_id: string | null }[] }),
    gameIds.length
      ? supabase.from("game_matches").select("game_id, side_a, side_b").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; side_a: unknown; side_b: unknown }[] }),
    gameIds.length
      ? supabase.from("game_participants").select("game_id, play_group_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; play_group_id: string | null }[] }),
    // Has it begun producing results? The §A "started" signal (R1): an `active`
    // game that has is genuinely underway (On Tap); an `active` game that has
    // not is enabled/pairings-up but not started (Ready for Play).
    //
    // ONE read of `game_started` (migration 161), replacing the two that used
    // to be merged here — score entries and outcome-mode hole outcomes — plus
    // the third that pick'em would have needed. The comment on the outcome
    // query named the shape ("it needs its OWN started source or it reads
    // Ready-for-Play forever") and pick'em made it a pattern, so the branch per
    // format lives in the view and a new format adds an arm there rather than a
    // fourth query here.
    //
    // Manual games score on post (→complete) and never produce rows, so they
    // correctly stay out of On Tap until they finish.
    gameIds.length
      ? supabase.from("game_started").select("game_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string }[] }),
    // The bracket roll-up's ONE extra input: which cup team each entrant plays
    // for. `bracket_entrants.team_id` is what makes a 2v2 pairing unable to span
    // two teams (migration 112), which is precisely what makes "so its points
    // land on one team" true rather than aspirational — so it is also the right
    // and only thing to roll up by. Skipped entirely when the competition has no
    // bracket.
    bracketGameIds.length
      // `game_id` rides along for the New/Configuring split — a seeded entrant is a
      // configuration act, and this query is already being issued.
      ? supabase.from("bracket_entrants").select("id, game_id, team_id").in("game_id", bracketGameIds)
      : Promise.resolve({ data: [] as { id: string; game_id: string; team_id: string | null }[] }),
  ]);
  const results = resultsRes.data;
  /**
   * Did the RESULTS read fail, as opposed to returning nothing?
   *
   * Checked here because migration 191 moved what the bracket's roll-up depends
   * on. It used to take its entrant→team map from `bracket_entrants`, and
   * `entrantReadError` below was the "unknown, not zero" guard on exactly that.
   * The credit now rides on the result row, so that guard would have gone INERT
   * while still reading like protection — a thing this codebase has found nine
   * times and has a rule about. The guard moves to the read it now guards.
   *
   * Deliberately NOT extended to the other arms in this PR. Every format's
   * standings have always come from this same unchecked read, so a failure has
   * always made every finished game render as unposted, silently — a real
   * finding, wider than this change, and filed as #1411 rather than folded in.
   */
  const resultsReadError = (resultsRes as { error?: { message: string } | null }).error ?? null;
  if (resultsReadError) {
    console.error("[competitionLeaderboard] results read failed — every game will show as unposted", {
      competitionId,
      error: resultsReadError.message,
    });
  }
  /**
   * ── `teamByEntrant` USED TO BE BUILT HERE, AND IS GONE ───────────────────
   *
   * It mapped entrant id → `bracket_entrants.team_id` AS OF THIS READ, and the
   * bracket arm rolled a finished game's points onto teams through it. That
   * made the bracket the one format whose finished result resolved its credited
   * unit through current state (ruling 15). Migration 191 stamps
   * `game_results.credited_team_id` at finalize, and the arm reads it off the
   * row instead.
   *
   * The QUERY stays: `entrant_count` below is what drives the board's
   * New/Configuring split, and a seeded entrant is a configuration act whether
   * or not anything has been played. Only the team column stopped being read
   * here — `select("id, game_id, team_id")` is deliberately left whole so the
   * shape still matches what `bracketPool` returns and the next reader does not
   * have to widen it back.
   */
  /** Seeded entrants per bracket game — a configuration act, so it feeds `isNew`. */
  const entrantCountByGame = new Map<string, number>();
  for (const e of (entrantRowsRes.data ?? []) as { game_id: string }[]) {
    entrantCountByGame.set(e.game_id, (entrantCountByGame.get(e.game_id) ?? 0) + 1);
  }
  /**
   * Did that read FAIL, as opposed to returning nothing?
   *
   * The distinction is the whole of CLAUDE.md #16's landmine pointed at this
   * function. "No entrants" and "we could not read the entrants" produce the same
   * empty map, and an unchecked failure would make every entrant look teamless —
   * so a finished bracket would quietly award nobody anything while the board
   * rendered as though that were the result. Points vanishing with no error is
   * the expensive failure, not points missing with one.
   *
   * The bracket branch below treats this as UNPOSTED rather than as zero: the
   * game contributes its pool and shows no awards yet, which is the honest
   * reading of "we don't know", and the next poll recovers. It is deliberately
   * not a throw — one sub-read failing should not blank a whole competition's
   * board — but it IS logged, because a silent degrade nobody can see is how the
   * six-week version of this bug happened.
   */
  const entrantReadError = (entrantRowsRes as { error?: { message: string } | null }).error ?? null;
  if (entrantReadError) {
    console.error("[competitionLeaderboard] bracket entrant read failed — brackets will show as unposted", {
      competitionId,
      bracketGameIds,
      error: entrantReadError.message,
    });
  }
  // Games that have begun producing results — the view already unions every
  // format's source, so there is nothing to merge here any more.
  const startedByGame = new Set<string>(
    ((startedRowsRes.data ?? []) as { game_id: string }[]).map((r) => r.game_id)
  );
  // Participant rows per game — "field picked" (stroke). For rack we track the
  // GROUPED count separately: rack readiness needs players assigned to a playing
  // group (the manual builder), so a bare roster with no groups isn't Ready — the
  // same bar the server enable guard uses, so the two can't disagree.
  const participantCountByGame = new Map<string, number>();
  const groupedParticipantCountByGame = new Map<string, number>();
  for (const r of (participantRowsRes.data ?? []) as { game_id: string; play_group_id: string | null }[]) {
    participantCountByGame.set(r.game_id, (participantCountByGame.get(r.game_id) ?? 0) + 1);
    if (r.play_group_id != null) {
      groupedParticipantCountByGame.set(r.game_id, (groupedParticipantCountByGame.get(r.game_id) ?? 0) + 1);
    }
  }
  // A match game's available points = value × the number of ASSIGNED matches
  // (both sides paired). "A match = assigned, everywhere" (round-3.1 addendum):
  // an unfilled slot is not a match — it never scores, so it contributes nothing
  // to points-in-play and doesn't make the game Ready. Empty slots are builder
  // scaffolding that the tee-off COLLAPSE discards; counting them here would show
  // a created-but-unpaired game phantom points. (Supersedes the earlier Slice-D
  // "configured rows incl. empty, ≥1 from creation" goalpost — pairing now moves
  // the live clinch target, by design.)
  const matchCountByGame = new Map<string, number>();
  // Total match ROWS (paired + the seeded/unpaired) per game — already in the
  // fetched data, no extra query. Feeds the readiness threshold: a match game is
  // configured only when EVERY row is paired (`paired === total`), the SAME bar
  // the setup-page Enable gate uses (`matchPlayReady`) — readiness rework P1b.
  const totalMatchRowsByGame = new Map<string, number>();
  for (const r of (matchRowsRes.data ?? []) as { game_id: string; side_a: unknown; side_b: unknown }[]) {
    totalMatchRowsByGame.set(r.game_id, (totalMatchRowsByGame.get(r.game_id) ?? 0) + 1);
    if (r.side_a == null || r.side_b == null) continue;
    matchCountByGame.set(r.game_id, (matchCountByGame.get(r.game_id) ?? 0) + 1);
  }

  // For placement games: value = position (lower wins).
  // For per_match games: value = raw_score (match points, higher wins).
  //
  // Split by entity_type, because the two kinds of row are ranked against
  // different fields and mixing them would be silent: a bracket's entrant
  // positions landing in `standingsByGame` would be ranked as if entrant ids were
  // team ids, awarding points to entities no team column will ever match.
  const standingsByGame = new Map<string, { entityId: string; value: number }[]>();
  const entrantStandingsByGame = new Map<
    string,
    { entityId: string; value: number; creditedTeamId: string | null }[]
  >();
  // ── PROVENANCE IS CARRIED, NOT INFERRED (#1381, after #1245) ────────────────
  // A team row carries its value in `position` (a RANK, low wins) or in
  // `raw_score` (POINTS already decided, high wins). This used to fold the two
  // into one number with `position ?? raw_score`, after which nothing could say
  // which it was, and each arm below picked a direction on its own. #1245 was
  // that collapse in the winner-take-all arm; #1381 was the same collapse one arm
  // down, in `isPlacement`. Patching arms one at a time is how the second one
  // shipped, so the convention now travels WITH the standings and
  // `reconcileConvention` ranks by it, whatever arm a game lands in.
  const teamRowsByGame = new Map<
    string,
    { entityId: string; position: number | null; rawScore: number | null; valueKind: string | null }[]
  >();
  for (const r of results ?? []) {
    const gid = r.game_id as string;
    if ((r.entity_type as string) === "entrant") {
      // Entrant rows are a bracket's placements and are ranked by the bracket arm
      // against its own field; they never meet the team conventions below. The
      // credit rides along because it is a property of THIS ROW, not of the
      // entrant as it stands today.
      const arr = entrantStandingsByGame.get(gid) ?? [];
      arr.push({
        entityId: r.entity_id as string,
        value: (r.position ?? r.raw_score ?? 0) as number,
        creditedTeamId: (r.credited_team_id as string | null) ?? null,
      });
      entrantStandingsByGame.set(gid, arr);
      continue;
    }
    const arr = teamRowsByGame.get(gid) ?? [];
    arr.push({
      entityId: r.entity_id as string,
      position: (r.position as number | null) ?? null,
      rawScore: (r.raw_score as number | null) ?? null,
      valueKind: (r.value_kind as string | null) ?? null,
    });
    teamRowsByGame.set(gid, arr);
  }
  const conventionByGame = new Map<string, RowConvention>();
  for (const [gid, rows] of teamRowsByGame) {
    // Declared beats contained, and a disagreement between them ranks nothing.
    // Both readings are kept: the declaration is the answer, the columns are
    // the check on it.
    const convention = resolveConvention(gid, declaredConvention(rows), rowConvention(rows));
    conventionByGame.set(gid, convention);
    standingsByGame.set(
      gid,
      rows.map((row) => ({
        entityId: row.entityId,
        value: (convention === "points" ? row.rawScore : row.position ?? row.rawScore) ?? 0,
      }))
    );
  }

  const armFor = (g: (typeof allGames)[number]): LiveGame | TeamArm => {
    const rawDist = g.points_distribution as PointsDistribution | null;
    const standings = standingsByGame.get(g.id as string) ?? [];

    /**
     * ── A BRACKET: entrant placements, rolled up to cup teams ────────────────
     *
     * FIRST, ahead of every other branch, and that ordering is load-bearing. A
     * bracket is a MANUAL game type wearing a descriptor, so it would otherwise
     * fall into the winner-take-all branch below and be awarded from `standings`
     * — which for a bracket is EMPTY, because its rows are entrant rows. The
     * failure would be silent and expensive: the board would show a finished
     * bracket contributing its points-in-play and awarding nobody anything.
     *
     * ── Why two steps and not one ────────────────────────────────────────────
     * Points are computed PER ENTRANT and only then summed onto teams. Ranking
     * teams directly cannot express what a bracket does: with 6 entrants over 2
     * teams, team A can finish 1st, 3rd and 5th, and one position per team has no
     * way to say so (migration 119's header). So the distribution is applied to
     * the entrant field — where #916's later places actually live, and where the
     * tie groups an elimination round produces get averaged by the same
     * `placementPoints` every other format uses — and the team total is the sum.
     *
     * ── The synthetic distribution is the existing mechanism, not a new one ──
     * `rollUp` awards by ranking standings against a distribution, and a bracket
     * arrives at this point with per-team POINTS already decided. That is exactly
     * the shape `per_match` has, and it is solved the same way: hand back the
     * sorted point values AS the distribution with `high_wins`, and
     * `placementPoints` passes them through unchanged — including ties, where a
     * group of size n shares the sum of n equal values and gets its own value
     * back. Two teams on the same points is a real outcome here (both entrants
     * knocked out in the same round), so the tie behaviour is used, not tolerated.
     *
     * A bracket with no configured split pays nothing and still contributes its
     * `points_total` to points-available — the same treatment the undistributed
     * placement shell at the bottom of this function gets, rather than a
     * bracket-specific guess about what the organizer meant.
     */
    if (isBracketGame(g.game_type_id as string | null, g.competition_format as string | null)) {
      // A failed RESULTS read is "unknown", not "nobody scored". Empty standings
      // here give the pre-decision shape — the game keeps its pool and awards
      // nothing until the next poll recovers. (This gated on `entrantReadError`
      // until 191; see the note beside `resultsReadError` for why it moved.)
      const entrantStandings = resultsReadError ? [] : entrantStandingsByGame.get(g.id as string) ?? [];
      // `effectiveDistribution`, NOT `isPlacement(...) ? values : []`. The empty
      // array awarded 0 to every entrant, and this branch returns before the
      // winner-take-all flatten below — so a bracket with no authored split paid
      // nothing at all while every other format flattened to its total.
      const pointsByEntrant = placementPoints(
        effectiveDistribution(rawDist, g.points_total as number | null),
        entrantStandings,
        "low_wins"
      );
      /**
       * ── THE CREDIT COMES OFF THE ROW, NOT OFF THE ENTRANT (ruling 15) ─────
       *
       * This used to be `teamByEntrant`, built from `bracket_entrants.team_id`
       * as it stands at READ time — the one place a finished result's credited
       * unit was still being resolved through current state. Migration 191
       * records it on the result row at finalize, and the 191 backfill derived
       * the existing rows from that same column, so this is provably the same
       * answer for every row in production today and a different one only after
       * the entrant's team moves.
       *
       * A NULL is still an entrant on no cup team, which
       * `teamPointsFromEntrants` skips — unchanged, and the reason a bracket
       * with one unassigned competitor still scores everyone else.
       *
       * The old `teamByEntrant` map is gone entirely — see the note where it
       * used to be built. The `bracket_entrants` query itself stays, because
       * the entrant COUNT still drives the board's New/Configuring split.
       */
      const creditByEntrant = new Map<string, string | null>(
        entrantStandings.map((e) => [e.entityId, e.creditedTeamId])
      );
      const teamPoints = teamPointsFromEntrants(pointsByEntrant, creditByEntrant);
      const sorted = [...teamPoints.entries()]
        .map(([entityId, value]) => ({ entityId, value }))
        .sort((a, b) => b.value - a.value);
      return {
        id: g.id as string,
        // Null before the bracket is posted (no entrant rows yet) — contributes
        // its pool and awards nothing, the same pre-decision state every other
        // format has.
        distribution: sorted.length > 0 ? sorted.map((s) => s.value) : null,
        numTeams: teamIds.length,
        standings: sorted,
        direction: "high_wins" as const,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    /**
     * ── PICK'EM: awarded from the ENGINE, never from the distribution column ──
     *
     * Before the finalize arm existed, a pick'em game reached the bottom of this
     * function and returned `distribution: null, standings: []` — contributing
     * its `points_total` to points-available and awarding nobody anything,
     * whatever `game_results` held. Every branch above it misses:
     * `isManualType` is false (its `resultStrategy` is `"pickem"`), and
     * `isPerMatch` / `isPlacement` both test a column pick'em never writes —
     * `set_pickem_points_total` is its only points writer and it sets the total
     * alone.
     *
     * So the arm is keyed on the ENGINE, resolved by the same function
     * `games.finish` dispatches on. Keying it on the distribution instead would
     * be keying it on a column whose value is always null.
     *
     * ── Two shapes, because the finalize writes two ─────────────────────────
     *
     * A points cup's rows carry POSITIONS, so the payout is derived HERE against
     * the current schedule — change the total afterwards and the board follows,
     * which is the whole reason the finalize did not snapshot it.
     *
     * The other two resolutions carry the points themselves: the figure IS the
     * result of the contest, and there is no schedule to defer to. Handed back
     * as a synthetic distribution with `high_wins`, the mechanism the bracket arm
     * above and the `per_match` arm below both already use — `placementPoints`
     * passes sorted values through unchanged, ties included.
     *
     * The discriminator is `scoringModel`, which is the same `pointsMode` input
     * `pickemResolution` reads on the write side. One question, one answer, at
     * both ends.
     */
    if (isPickemGame(g.game_type_id as string | null, g.competition_format as string | null)) {
      const pointsTotal = (g.points_total as number | null) ?? undefined;
      if (scoringModel === "points") {
        return {
          id: g.id as string,
          // `effectiveDistribution`, not `isPlacement(d) ? d.values : []` — pick'em
          // authors no split, so the ternary would pay nobody. Winner takes the
          // lot is what every other format does with a null distribution.
          expects: "positions" as const,
          schedule: effectiveDistribution(rawDist, g.points_total as number | null),
          numTeams: teamIds.length,
          standings,
          pointsTotal,
        };
      }
      // No rows yet — not finalized. Contributes its pool and awards nothing,
      // the pre-decision state every other format has.
      if (standings.length === 0) {
        return {
          id: g.id as string,
          expects: "points" as const,
          numTeams: teamIds.length,
          standings: [],
          pointsTotal,
        };
      }
      const sorted = [...standings].sort((a, b) => b.value - a.value);
      return {
        id: g.id as string,
        expects: "points" as const,
        numTeams: teamIds.length,
        standings: sorted,
        pointsTotal,
      };
    }

    // Match-play, non-golf MANUAL game → winner-take-all. The owner-set total all
    // goes to the winner (position 1); a tie (both at position 1) splits it —
    // placementPoints averages [P,0] → P/2 each, the same averaged convention a
    // golf match-play halve uses. Manual games only (result_strategy NULL) —
    // golf untouched.
    //
    // ── …UNLESS the game carries its own placement split ──────────────────────
    // `!isPlacement(rawDist)` is the whole of this change, and it REMOVES an
    // override rather than adding a capability.
    //
    // `competitions.scoring_model` is one column holding two axes. It was
    // introduced (migration 062) to branch "the NON-GOLF result model ONLY" — a
    // PER-GAME question — but stored on the competition, which was right at the
    // time because every non-golf game in a cup wanted the same answer. It has
    // since also acquired genuinely competition-level duties: the 2-team lock,
    // the teams structure lock, the board layout, the hero, the projection pills.
    //
    // The per-game axis already exists and is already dispatched on three lines
    // below: `points_distribution`'s SHAPE. `per_match` is a match-play award;
    // `placement` is a split. This branch sat ABOVE both and returned first, so a
    // competition-level flag silently overrode a per-game field. Now it defers
    // when the game has actually been given a split, and remains the default for
    // every manual game that has not — which is what it has always meant, since
    // until now no such game could have one (the settings row was hidden).
    //
    // ── …AND ONLY WHERE THERE ARE NO PER-MATCH ROWS ───────────────────────────
    //
    // THE CONDITION IS THE ABSENCE OF MATCH ROWS, NOT THE GAME'S TYPE. This
    // branch reads a standing's `value` as a POSITION — "the total goes to the
    // winner (position 1)", ranked `low_wins`. That is only sound for a game
    // whose results carry a position. A game with per-match rows is scored by
    // `writeTeamMatchPoints`, which deliberately writes `position = null` and
    // puts POINTS in `raw_score` — and `standingsByGame` USED TO collapse the two
    // with `position ?? raw_score`, so the points arrived here wearing a
    // position's clothes and nothing could tell them apart. (Since #1381 the
    // convention travels with the standings and `reconcileConvention` ranks by
    // it; this guard stays because it keeps the game in the arm that also sizes
    // its pool correctly.)
    //
    // Ranked `low_wins`, a team that won 35 reads as "position 35" and a team
    // that won nothing reads as "position 0" — so WINNING DEMOTED YOU, and the
    // whole pot went to the side that lost every match (#1245, seen on a real
    // cup). The `isPerMatch` arm below is the one that reads `raw_score` as
    // points; it already handles these games (its `pointsDivideByMatchRows`
    // includes `isMatchesGame`) and was simply never reached, because this
    // branch returned first.
    //
    // This comment previously read: "A manual game holding a `per_match`
    // distribution keeps the flatten, because per_match is match play's own
    // shape and the branch below derives its match count from pairings a manual
    // game does not have." That was TRUE WHEN WRITTEN and is now false — non-golf
    // Matches (170) is a manual type that does have pairings. The fact was
    // restated where the condition should have been, so when the fact changed
    // there was nothing to re-check. Hence the predicate below names what
    // actually makes a game eligible.
    const hasPerMatchRows = (totalMatchRowsByGame.get(g.id as string) ?? 0) > 0;
    if (
      scoringModel === "match_play" &&
      isManualType(g.game_type_id as string | null) &&
      !isPlacement(rawDist) &&
      !hasPerMatchRows
    ) {
      const total = (g.points_total as number | null) ?? 0;
      return {
        id: g.id as string,
        expects: "positions" as const,
        // [total, 0], NOT effectiveDistribution's [total]: nobody has measured
        // that the two pay a tie the same, so 3b does not unify them.
        schedule: total > 0 ? [total, 0] : null,
        numTeams: teamIds.length,
        standings,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    if (isPerMatch(rawDist)) {
      const typeId = g.game_type_id as string | null;
      // NOT "is this gtt_match_play" — that is a different question that
      // happened to share an answer while match play was the only format
      // writing match rows. Pick'em writes them too, and took the roster-derived
      // arm: a plausible non-zero pool sized by min(teamA, teamB), with
      // points_total ignored (#1101).
      const dividesByMatchRows = pointsDivideByMatchRows(typeId, g.competition_format as string | null);
      const isRackType = typeId === RACK_TYPE;
      // Match play (singles/doubles): available = value × the game's ASSIGNED
      // match count (game_matches rows with both sides paired) — an unfilled slot
      // isn't a match, so it adds no points (round-3.1 "a match = assigned"). The
      // live clinch goalpost moves as matches get paired / added / removed. Rack
      // DOESN'T use game_matches; its legacy `mc` fallback is the team-size-derived
      // head-to-head sizing (unchanged stable model) — so counting rows there would
      // zero them out.
      /**
       * ── A FINISHED GAME'S POOL DOES NOT MOVE WITH TODAY'S ROSTER ─────────
       *
       * `deriveMatchCount(teamSizes, …)` sizes the pool from `team_assignments`
       * AS OF THIS READ. For a LIVE game that is right — the clinch goalpost is
       * supposed to move as people are added and the slate grows, and the plan's
       * ruling 15 says a projection of an unfinished game may use current
       * rosters. For a COMPLETE one it is the same violation the credited unit
       * had: a fact about THEN, re-derived from NOW, so trading a player after
       * a game is decided silently changes how many points that game had in
       * play, and therefore the number every team is chasing.
       *
       * A complete game's pool is what it actually paid. `awardedForGame` sums
       * the distribution over the teams, which is the same expression
       * `rollUp` uses for points-available — so this does not invent a second
       * definition, it stops a roster read from standing in for one.
       *
       * ── The one case where the two answers genuinely differ ─────────────
       *
       * `value × mc` counts every slot as available whether or not it paid
       * anybody; the sum of the standings counts only what landed. They agree
       * on a normal game (rack's own integration test pins 2 slots × 2 = 4, and
       * the standings sum to the same 4) and diverge when a match paid NOBODY —
       * a side with no cup team, the case `awardMatches` now counts as
       * `unpayable`. For a DECIDED game the standings sum is the better of the
       * two: a clinch target that includes points nothing can ever award is a
       * target no team can reach. Stated rather than smuggled, because it is a
       * semantic change and not only a de-rostering.
       *
       * NOT LIVE TODAY, and that is measured rather than assumed: every
       * completed rack and match-play game in production carries an owner-set
       * `points_total`, so `pointsTotal` below never reaches the `value × mc`
       * fallback. This closes the path before something takes it.
       */
      const isComplete = (g.status as string | null) === "complete";
      const mc = dividesByMatchRows
        ? matchCountByGame.get(g.id as string) ?? 0
        : isComplete
          ? 0
          : deriveMatchCount(teamSizes, matchFormat(typeId)) ?? 0;
      // A2b (match play) + the rack total-points migration: once an owner sets
      // `points_total`, it's the authoritative total — `value × mc` only equals it
      // when there's no drift (match play: no overrides; rack: this leaderboard's
      // roster-derived `mc` happens to match the setup page's game-participant-
      // derived slot count). Reading `points_total` directly (derive-don't-snapshot)
      // sidesteps that pre-existing divisor mismatch for any game with an owner-set
      // total. A legacy game (pre-migration, null total) falls back to `value × mc`,
      // its old behavior — unchanged for both formats.
      // A2b (match play) + the rack total-points migration: once an owner sets
      // `points_total`, it's the authoritative total. A legacy game (pre-migration,
      // null total) falls back to `value × mc` while LIVE; once complete, `mc` is
      // 0 above and the fallback becomes what the game awarded, read off the
      // standings rather than off a roster.
      const legacyPool = isComplete
        ? awardedForGame(
            standings.length > 0 ? [...standings].sort((a, b) => b.value - a.value).map((x) => x.value) : null,
            teamIds.length
          )
        : rawDist.value * mc;
      const pointsTotal = dividesByMatchRows || isRackType
        ? (g.points_total as number | null) ?? legacyPool
        : legacyPool;
      if (standings.length === 0) {
        // No decided matches yet — contributes its available pool, no awards.
        return { id: g.id as string, expects: "points" as const, numTeams: teamIds.length, standings: [], pointsTotal };
      }
      const sorted = [...standings].sort((a, b) => b.value - a.value);
      return {
        id: g.id as string,
        expects: "points" as const,
        numTeams: teamIds.length,
        standings: sorted,
        pointsTotal,
      };
    }

    if (isPlacement(rawDist)) {
      // Available uses the owner-set total (counts even before distribution —
      // stable clinch). A legacy game with no total (null) falls back to the
      // distribution sum via rollUp's awardedForGame.
      //
      // `low_wins` is right for the rows this split is FOR — positions. A game
      // whose rows carry points instead (a per-match game holding a split, #1381)
      // is re-ranked by `reconcileConvention`, not by this arm guessing.
      return {
        id: g.id as string,
        expects: "positions" as const,
        schedule: rawDist.values,
        numTeams: teamIds.length,
        standings,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    // null / unknown distribution shape: an undistributed placement SHELL still
    // contributes its owner-set total (the Game-tab value saved before the
    // Configuration-tab split exists). No total → contributes nothing.
    return {
      id: g.id as string,
      expects: "positions" as const,
      schedule: null,
      numTeams: teamIds.length,
      standings: [],
      pointsTotal: (g.points_total as number | null) ?? undefined,
    };
  };

  // Every TEAM arm is ranked by the reconciliation, from its rows' declaration.
  // The bracket arm ranks its own entrant field and returns a finished LiveGame
  // — the one arm that still decides its own direction, deliberately: 3b left it
  // out, and production's 14 entrant rows (3 games) all declare rank with a
  // position, measured 2026-09-23.
  const liveGames: LiveGame[] = allGames.map((g) => {
    const armed = armFor(g);
    if (!("expects" in armed)) return armed;
    return reconcileConvention(armed, conventionByGame.get(g.id as string), {
      competitionId,
      rawDistribution: (g.points_distribution as PointsDistribution | null) ?? null,
      pointsTotal: (g.points_total as number | null) ?? null,
    });
  });

  const roll = rollUp(liveGames, teamIds, { defendingTeamId: comp?.defending_team_id ?? null });

  // Per-game points in play, keyed by id — the SAME per-game expression rollUp
  // sums into points-available (owner-set total, else the distribution sum). The
  // board row's outer column (§A5 `N PTS`) reads this so a match-play game —
  // whose `distribution` is null until decided — still shows its potential, AND
  // a distribution-only placement game (no owner total) shows its sum instead of
  // a bare `—`. Built from the computed liveGames so the row can't diverge from
  // the standings.
  const ptsInPlayByGame = new Map<string, number>(
    liveGames.map((g) => [g.id, g.pointsTotal ?? awardedForGame(g.distribution, g.numTeams)])
  );

  // Per-game grid cells (place + points per team) — same averaging as the totals,
  // so the grid and the totals can't disagree. Only live games carry cells.
  const cells: { gameId: string; teamId: string; place: number; points: number }[] = [];
  for (const g of liveGames) {
    if (!g.distribution || g.standings.length === 0) continue;
    const detail = placementDetail(g.distribution, g.standings, g.direction);
    for (const [teamId, d] of detail) {
      cells.push({ gameId: g.id, teamId, place: d.place, points: d.points });
    }
  }

  // Live per-team projections (leaderboard grid Phase 2). Only in-progress
  // (active & started) match/rack games get a "if today holds" projection — the
  // board's LIVE-section pill. Runs the SAME pure functions the game page uses
  // (Path A), read-only, and rides this payload's existing 30s poll (no new
  // fetch on the client, converges across devices for free). Stroke/non-golf and
  // not-yet-started games have no projection → their rows keep the plain layout.
  // ── The pill is gated on STARTED — and pick'em has now joined (3c) ──────
  //
  // This comment used to argue pick'em should NOT join the allowlist, and the
  // argument was about one state: a locked game with zero results, where every
  // sheet scores 0 and the pill would read 0 to each side — "pick'em is worth
  // nothing" where "pick'em has not started" was true. That argument still
  // holds and is still honoured, by the same line it named: `started` (a
  // pick'em game is started on its first slate result, migration 161), so
  // there is no pill until the first result, then a real one.
  //
  // What changed is that there is now a real one to show. `projectPickem`
  // runs finalize's own builder into `pickemFinalize` (rulings 13 and 14), is
  // gated on reveal because this board is computed under the viewer's RLS, and
  // says `cannot` with a reason rather than projecting a pot of nothing.
  const liveProjectionInputs: LiveProjectionInput[] = allGames
    .filter((g) => {
      const t = g.game_type_id as string | null;
      const cf = g.competition_format as string | null;
      return (
        g.status === "active" &&
        startedByGame.has(g.id as string) &&
        ((t != null && MATCH_PLAY_TYPES.has(t)) || t === RACK_TYPE || isMatchesGame(t, cf) || isPickemGame(t, cf))
      );
    })
    .map((g) => {
      const dist = g.points_distribution as PointsDistribution | null;
      return {
        id: g.id as string,
        gameTypeId: (g.game_type_id as string | null) ?? null,
        competitionFormat: (g.competition_format as string | null) ?? null,
        // #1031: pass the raw total + the distribution TYPE, not a precomputed
        // per-match/per-slot value — `computeLiveProjections` derives that LIVE
        // from the bulk-fetched matches/roster it already has, so the board's
        // pill can't lag the persisted `points_distribution.value` snapshot.
        pointsTotal: (g.points_total as number | null) ?? null,
        isPerMatch: isPerMatch(dist),
        // Legacy fallback: a pre-A2b game with no owner-set total has no total to
        // derive from — consulted only when pointsTotal above is null.
        legacyValue: isPerMatch(dist) ? dist.value : null,
        // Refactor B3: an outcome-mode match projects from recorded outcomes,
        // not gross scores (it has none).
        outcomeMode: (g.entry_mode as string | null) === "outcome",
        // Pick'em's points cup pays by the schedule derived from this.
        pointsDistribution: dist,
      };
    });
  const live = await computeLiveProjections(supabase, competitionId, liveProjectionInputs, {
    pointsMode: scoringModel === "points",
  });
  const cannotProject = live.cannotProject;
  // Every cup team, explicitly, on every projected game. An arm reports only the
  // teams it met, and the row used to supply the rest with `?? 0` — a number the
  // client made up. A team with no side in a game genuinely projects 0 here, and
  // this is where that is known, so this is where it is said.
  const projections: typeof live.projections = {};
  for (const [gameId, byTeam] of Object.entries(live.projections)) {
    projections[gameId] = Object.fromEntries(teamIds.map((id) => [id, byTeam[id] ?? 0]));
  }

  // Competition-total projection ("if today holds"): banked (teamTotals) + Σ of each
  // team's live-game projections, summed SERVER-SIDE so the hero reads one authoritative
  // total off this payload (no client re-aggregation → no board-vs-client drift). Rides
  // the same 30s poll + faceBootstrap seed as the per-game pills. `hasLive` gates the
  // hero's whole projected tier (≥1 game live), independent of any team's delta.
  const projected = projectedTeamTotals(
    Object.fromEntries(roll.teamTotals),
    projections,
    teamIds,
  );

  return {
    teams: teams ?? [],
    // The cup's scoring model — lets header/hero consumers type-gate match-play
    // chrome (the "first to X" target line) off for points cups.
    scoringModel,
    defendingTeamId: (comp?.defending_team_id as string | null) ?? null,
    games: allGames.map((g) => {
      const rawDist = g.points_distribution as PointsDistribution | null;
      const typeId = (g.game_type_id as string | null) ?? null;
      const hasPoints = !!rawDist || g.points_total != null;
      const gid = g.id as string;
      return {
        id: gid,
        name: (g.name as string | null) ?? "Game",
        distribution: isPlacement(rawDist) ? rawDist.values : null,
        status: g.status as string,
        gameTypeId: typeId,
        // "ready to score" = points are configured (a distribution shape or an
        // owner-set total). Kept for the games-panel/test consumers.
        ready: hasPoints,
        // The §A readiness gate: is the format's REQUIRED roster assigned? Drives
        // the Setting-up↔Ready transition AND the `N PTS`/`—` outer column from
        // ONE signal so they can't disagree (course/handicaps never gate this).
        configured: isConfigured(
          typeId,
          matchCountByGame.get(gid) ?? 0,
          totalMatchRowsByGame.get(gid) ?? 0,
          // Stroke + rack both gate on GROUPED players (mandatory groupings, 089).
          ((typeId && ROSTER_TYPES.has(typeId)) ? groupedParticipantCountByGame : participantCountByGame).get(gid) ?? 0,
          hasPoints,
          g.competition_format as string | null
        ),
        /**
         * NEW — nothing configured yet, only what the add-game modal wrote.
         *
         * Shipped as its own signal rather than re-derived on the client, so the
         * board reads one authoritative answer. `configured` above is UNCHANGED —
         * this is a second, earlier question, not a new Ready threshold.
         *
         * The child-row count is composed from the three sets this function
         * already fetched: participants, match rows and bracket entrants. Any row
         * in any of them means somebody built something. `play_groups` and
         * `bracket_matches` are not counted directly and do not need to be — a
         * play group is only ever created by the group builder, which assigns
         * participants in the same call, and a draw's matches are minted by the
         * field builder, which writes `bracket_config` and the entrants alongside.
         * Both are covered transitively; `gameNewState.test.ts` pins each.
         */
        isNewGame: isNew(g as Record<string, unknown>, (
          (participantCountByGame.get(gid) ?? 0) +
          (totalMatchRowsByGame.get(gid) ?? 0) +
          (entrantCountByGame.get(gid) ?? 0)
        )),
        // Course presence (§ scorecard three-way) — surfaced so the row's
        // scorecard chip can be a real button (course set) vs a muted status
        // icon (no course). Course is optional and never an error.
        hasCourse: g.course_id != null,
        // Scoring enabled (Phase 2B.1) — the real arming signal the format-icon
        // color reads (§A4), replacing the Phase-3 derived stub.
        scoringEnabled: g.scoring_enabled === true,
        // Has ≥1 score entry (R1) — splits `active` into On Tap (started) vs
        // Ready for Play (enabled/pairings up, not started) for the board sections.
        started: startedByGame.has(gid),
        // Re-opened for a score correction. Only meaningful once `status` is
        // "complete" (`gameLockState` is the shared reading of the pair) — the
        // board uses it to mark the row provisional. Deliberately NOT role-gated:
        // a member can correct their own scores in this mode, so it is a state
        // they participate in rather than someone else's private edit.
        correctionsOpen: g.corrections_open === true,
        // Points in play (§A5 outer column). Match-play games carry it here even
        // though `distribution` is null pre-decision.
        pointsTotal: ptsInPlayByGame.get(gid) ?? null,
      };
    }),
    cells,
    // gameId → teamId → projected points (LIVE match/rack games only). The board
    // renders these as the ▲ projected-points pill in each team column.
    projections,
    // gameId → why a LIVE game whose format projects can't right now (3c). Disjoint
    // from `projections`; a live game in neither has a format with no projection.
    cannotProject,
    pointsAvailable: roll.pointsAvailable,
    winNumber: roll.winNumber,
    teamTotals: Object.fromEntries(roll.teamTotals),
    // Hero "if today holds" tier: per-team projected total (banked + Σ live projections)
    // + whether any game is live (the tier-visibility gate). Server-summed (Path A).
    projectedTeamTotals: projected.totals,
    hasLiveProjection: projected.hasLive,
    pointsToClinch: Object.fromEntries(roll.pointsToClinch),
  };
}
