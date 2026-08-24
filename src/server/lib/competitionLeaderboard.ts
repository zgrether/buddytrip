import type { SupabaseClient } from "@supabase/supabase-js";
import { rollUp, placementDetail, placementPoints, awardedForGame, type LiveGame } from "@/lib/competitionPlacement";
import { isPerMatch, isPlacement, effectiveDistribution, type PointsDistribution } from "@/lib/pointsDistribution";
import { teamPointsFromEntrants } from "@/lib/bracketPlacements";
import { isBracketGame } from "@/lib/resultStrategy";
import { deriveMatchCount, type MatchFormat } from "@/lib/gameConfig";
import { projectedTeamTotals } from "@/lib/gameProjection";
import { isManualGameType, type ScoringModel } from "@/lib/gameTypes";
// isConfigured (+ the type sets) moved to gameReadiness.ts (A2-core) so the same
// "is it configured?" signal backs both this display AND the server enable guard.
import { isConfigured, isNew, MATCH_PLAY_TYPES, RACK_TYPE, ROSTER_TYPES } from "@/server/lib/gameReadiness";
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
  const [resultsRes, matchRowsRes, participantRowsRes, scoreEntryRowsRes, outcomeRowsRes, entrantRowsRes] = await Promise.all([
    gameIds.length
      ? supabase
          .from("game_results")
          // `entity_type` is now SELECTED and the filter is a set, because a
          // bracket's results name entrants rather than teams (migration 119).
          // Splitting the rows by type below is what keeps a bracket's entrant
          // placements out of another game's team standings and vice versa —
          // reading them as one list would rank entrant ids against team ids.
          .select("game_id, entity_id, entity_type, position, raw_score")
          .in("game_id", gameIds)
          .in("entity_type", ["team", "entrant"])
      : Promise.resolve({ data: [] as { game_id: string; entity_id: string; entity_type: string; position: number | null; raw_score: number | null }[] }),
    gameIds.length
      ? supabase.from("game_matches").select("game_id, side_a, side_b").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; side_a: unknown; side_b: unknown }[] }),
    gameIds.length
      ? supabase.from("game_participants").select("game_id, play_group_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string; play_group_id: string | null }[] }),
    // Any score entered yet? The §A "started" signal (R1): an `active` game with
    // ≥1 score entry is genuinely underway (On Tap); an `active` game with none is
    // enabled/pairings-up but not started (Ready for Play). Manual games score on
    // post (→complete) so they never carry entries — correctly staying out of On
    // Tap until they finish.
    gameIds.length
      ? supabase.from("score_entries").select("game_id").in("game_id", gameIds)
      : Promise.resolve({ data: [] as { game_id: string }[] }),
    // Refactor B3: the outcome-mode counterpart — an outcome game never has
    // score_entries rows, so it needs its OWN "started" source or it reads
    // Ready-for-Play forever, however many holes are decided.
    gameIds.length
      ? supabase.from("match_hole_outcomes").select("game_id").in("game_id", gameIds)
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
   * entrant id → cup team. Built across every bracket in the competition at
   * once; entrant ids are unique per game (they carry the game id), so one flat
   * map cannot collide across games.
   *
   * A missing entry means the entrant has no team — a standalone-style entrant
   * in a cup game. `teamPointsFromEntrants` skips those rather than dropping
   * them from the record, which is what lets a bracket with an unassigned
   * competitor still score everyone else correctly.
   */
  const teamByEntrant = new Map<string, string | null>(
    ((entrantRowsRes.data ?? []) as { id: string; game_id: string; team_id: string | null }[]).map((e) => [e.id, e.team_id ?? null])
  );
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
  // Games with at least one score entry OR ≥1 decided hole outcome — drives
  // `started` on each game below. The two sources are mutually exclusive per
  // game (a game is one entry_mode), so merging them is always safe.
  const startedByGame = new Set<string>();
  for (const r of (scoreEntryRowsRes.data ?? []) as { game_id: string }[]) {
    startedByGame.add(r.game_id);
  }
  for (const r of (outcomeRowsRes.data ?? []) as { game_id: string }[]) {
    startedByGame.add(r.game_id);
  }
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
  const entrantStandingsByGame = new Map<string, { entityId: string; value: number }[]>();
  for (const r of results ?? []) {
    const target = (r.entity_type as string) === "entrant" ? entrantStandingsByGame : standingsByGame;
    const gid = r.game_id as string;
    const arr = target.get(gid) ?? [];
    arr.push({ entityId: r.entity_id as string, value: (r.position ?? r.raw_score ?? 0) as number });
    target.set(gid, arr);
  }

  const liveGames: LiveGame[] = allGames.map((g) => {
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
      // A failed entrant read is "unknown", not "nobody scored" — see the note on
      // `entrantReadError`. Empty standings here give the pre-decision shape.
      const entrantStandings = entrantReadError ? [] : entrantStandingsByGame.get(g.id as string) ?? [];
      // `effectiveDistribution`, NOT `isPlacement(...) ? values : []`. The empty
      // array awarded 0 to every entrant, and this branch returns before the
      // winner-take-all flatten below — so a bracket with no authored split paid
      // nothing at all while every other format flattened to its total.
      const pointsByEntrant = placementPoints(
        effectiveDistribution(rawDist, g.points_total as number | null),
        entrantStandings,
        "low_wins"
      );
      const teamPoints = teamPointsFromEntrants(pointsByEntrant, teamByEntrant);
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
    // Deliberately narrow: `isPlacement` only. A manual game holding a `per_match`
    // distribution keeps the flatten, because per_match is match play's own shape
    // and the branch below derives its match count from pairings a manual game
    // does not have.
    if (
      scoringModel === "match_play" &&
      isManualType(g.game_type_id as string | null) &&
      !isPlacement(rawDist)
    ) {
      const total = (g.points_total as number | null) ?? 0;
      return {
        id: g.id as string,
        distribution: total > 0 ? [total, 0] : null,
        numTeams: teamIds.length,
        standings,
        direction: "low_wins" as const,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    if (isPerMatch(rawDist)) {
      const typeId = g.game_type_id as string | null;
      const isMatchPlayType = typeId != null && MATCH_PLAY_TYPES.has(typeId);
      const isRackType = typeId === RACK_TYPE;
      // Match play (singles/doubles): available = value × the game's ASSIGNED
      // match count (game_matches rows with both sides paired) — an unfilled slot
      // isn't a match, so it adds no points (round-3.1 "a match = assigned"). The
      // live clinch goalpost moves as matches get paired / added / removed. Rack
      // DOESN'T use game_matches; its legacy `mc` fallback is the team-size-derived
      // head-to-head sizing (unchanged stable model) — so counting rows there would
      // zero them out.
      const mc = isMatchPlayType
        ? matchCountByGame.get(g.id as string) ?? 0
        : deriveMatchCount(teamSizes, matchFormat(typeId)) ?? 0;
      // A2b (match play) + the rack total-points migration: once an owner sets
      // `points_total`, it's the authoritative total — `value × mc` only equals it
      // when there's no drift (match play: no overrides; rack: this leaderboard's
      // roster-derived `mc` happens to match the setup page's game-participant-
      // derived slot count). Reading `points_total` directly (derive-don't-snapshot)
      // sidesteps that pre-existing divisor mismatch for any game with an owner-set
      // total. A legacy game (pre-migration, null total) falls back to `value × mc`,
      // its old behavior — unchanged for both formats.
      const pointsTotal = isMatchPlayType || isRackType
        ? (g.points_total as number | null) ?? rawDist.value * mc
        : rawDist.value * mc;
      if (standings.length === 0) {
        // No decided matches yet — contributes its available pool, no awards.
        return { id: g.id as string, distribution: null, numTeams: teamIds.length, standings: [], direction: "high_wins" as const, pointsTotal };
      }
      const sorted = [...standings].sort((a, b) => b.value - a.value);
      return {
        id: g.id as string,
        distribution: sorted.map((s) => s.value),
        numTeams: teamIds.length,
        standings: sorted,
        direction: "high_wins" as const,
        pointsTotal,
      };
    }

    if (isPlacement(rawDist)) {
      // Available uses the owner-set total (counts even before distribution —
      // stable clinch). A legacy game with no total (null) falls back to the
      // distribution sum via rollUp's awardedForGame.
      return {
        id: g.id as string,
        distribution: rawDist.values,
        numTeams: teamIds.length,
        standings,
        direction: "low_wins" as const,
        pointsTotal: (g.points_total as number | null) ?? undefined,
      };
    }

    // null / unknown distribution shape: an undistributed placement SHELL still
    // contributes its owner-set total (the Game-tab value saved before the
    // Configuration-tab split exists). No total → contributes nothing.
    return {
      id: g.id as string,
      distribution: null,
      numTeams: teamIds.length,
      standings: [],
      direction: "low_wins" as const,
      pointsTotal: (g.points_total as number | null) ?? undefined,
    };
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
  const liveProjectionInputs: LiveProjectionInput[] = allGames
    .filter((g) => {
      const t = g.game_type_id as string | null;
      return (
        g.status === "active" &&
        startedByGame.has(g.id as string) &&
        ((t != null && MATCH_PLAY_TYPES.has(t)) || t === RACK_TYPE)
      );
    })
    .map((g) => {
      const dist = g.points_distribution as PointsDistribution | null;
      return {
        id: g.id as string,
        gameTypeId: (g.game_type_id as string | null) ?? null,
        pointsPerMatch: isPerMatch(dist) ? dist.value : 0,
        // Refactor B3: an outcome-mode match projects from recorded outcomes,
        // not gross scores (it has none).
        outcomeMode: (g.entry_mode as string | null) === "outcome",
      };
    });
  const projections = await computeLiveProjections(supabase, competitionId, liveProjectionInputs);

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
          hasPoints
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
