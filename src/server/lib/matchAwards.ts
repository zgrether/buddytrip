import type { SupabaseClient } from "@supabase/supabase-js";
import { writeGameResults, type WriteFailureMode } from "./writeGameResults";
import { tallyMatchAwards, teamsInGame, type SideRef } from "@/lib/matchAwards";
import { playGroupUnits } from "@/lib/sideUnit";
import { maybeRowOrThrow, rowsOrThrow } from "./rowOrThrow";

/**
 * The DB-WRITE half of the per-match team award — see `@/lib/matchAwards` for
 * the pure rule itself (win takes the match's value, a draw splits it) and why
 * it's split out this way (CLAUDE.md pattern #8: one pure fn, three callers —
 * this write, the board's live projection, and the game page's own live
 * projection, none of which may disagree).
 *
 * ── What it reads, and what it deliberately does not ───────────────────────
 *
 * Only `game_matches.result` + `point_value`, plus the roster tables needed to
 * resolve a side to its cup team. No `score_entries`, no `match_hole_outcomes`,
 * no scorecard schema, no stroke index, no handicaps. That is what makes it
 * servable by a format with no holes at all.
 */

/**
 * A match whose result is known — the only thing this module needs from whatever
 * decided it.
 *
 * Declared STRUCTURALLY rather than imported as golf's `MatchOutcome`, and that
 * is the difference between an extraction and a rename. Importing it would have
 * left `matchPlay -> matchAwards -> matchPlay`: a type-only cycle TypeScript
 * tolerates, but one that keeps this module reachable only through the file it
 * was extracted from — so the next reader still finds golf at the other end and
 * concludes the coupling is real.
 *
 * Golf's `MatchOutcome` satisfies this by having the two fields; nothing had to
 * change to make it fit, which is the evidence that this was always the true
 * input and the rest of that type was never consulted here.
 */
export interface DecidedMatch {
  matchId: string;
  result: "a_win" | "b_win" | "halve" | null;
}

/** Aggregate decided match outcomes into per-team competition points and write
 *  them to game_results (entity_type='team', raw_score=accumulated points).
 *  Combines skipped-complete matches (from the initial query's result field)
 *  with freshly-computed outcomes so the team total is always complete.
 *
 *  A2b: each match is worth `point_value ?? evenShareFallback` — the per-match
 *  override when set, else the game's LIVE derived even share (#1031:
 *  `liveMatchPointsPerMatch`, recomputed from the current assigned matches — NOT
 *  a persisted `points_distribution.value` snapshot). So a "counts double" match
 *  awards its own value.
 *
 *  The reads and the write in one call, for a caller with nothing written yet
 *  (the non-golf Matches finalize). A caller that writes OTHER rows first must
 *  use `prepareTeamMatchPoints` and read before it writes — see there. */
export async function writeTeamMatchPoints(
  supabase: SupabaseClient,
  gameId: string,
  competitionId: string,
  evenShareFallback: number,
  allMatches: AwardMatch[],
  freshOutcomes: DecidedMatch[],
  onFailure?: WriteFailureMode
) {
  const write = await prepareTeamMatchPoints(supabase, gameId, competitionId);
  await write(evenShareFallback, allMatches, freshOutcomes, onFailure);
}

type AwardMatch = { id: unknown; side_a: unknown; side_b: unknown; result: unknown; point_value?: unknown };

/**
 * Do every READ the team write needs, and hand back the write (#1470).
 *
 * Split because of golf match play, which writes its SIDE rows first. On a
 * finalize that write is `scope: "all"`, so it deletes every row the game has —
 * team rows included — and the team rows only come back when this write runs.
 * With the reads here happening after that, a failed roster read left a
 * finished game with no team rows at all: the delete had landed and the
 * replacement never did. So a caller reads first, writes its own rows, then
 * calls the function this returns, which reads nothing.
 *
 * Every read is checked (the `rowOrThrow` family). Unchecked, a failed roster
 * read resolved no side, and in a Match Play cup `teamsInGame` still returns
 * both teams, so each was written 0 over its real total.
 */
export async function prepareTeamMatchPoints(
  supabase: SupabaseClient,
  gameId: string,
  competitionId: string
): Promise<
  (evenShareFallback: number, allMatches: AwardMatch[], freshOutcomes: DecidedMatch[], onFailure?: WriteFailureMode) => Promise<void>
> {
  // user → team for this competition.
  const assignments = rowsOrThrow(
    await supabase.from("team_assignments").select("user_id, team_id").eq("competition_id", competitionId),
    "cup's rosters"
  );
  const userTeam = new Map<string, string>();
  for (const a of assignments) {
    userTeam.set(a.user_id as string, a.team_id as string);
  }

  // play_group → its unit (2v2), by the ONE rule every surface uses (`sideUnit`):
  // the members' team only when they all share it. Empty for 1v1.
  const pgMembers = rowsOrThrow(
    await supabase.from("game_participants").select("user_id, play_group_id").eq("game_id", gameId),
    "game's players"
  );
  const pgTeam = playGroupUnits(
    pgMembers as { user_id: string; play_group_id: string | null }[],
    (id) => userTeam.get(id),
  );
  // A side resolves to its unit via the user map (1v1) or the play_group map (2v2).
  const sideTeam = (s: SideRef): string | undefined =>
    (s.type === "play_group" ? pgTeam.get(s.id) : userTeam.get(s.id)) ?? undefined;

  const [teamsRes, compRes] = await Promise.all([
    supabase.from("teams").select("id").eq("competition_id", competitionId),
    supabase.from("competitions").select("scoring_model").eq("id", competitionId).maybeSingle(),
  ]);
  const compTeamIds = rowsOrThrow(teamsRes, "cup's teams").map((t) => t.id as string);
  const isMatchPlayCup = maybeRowOrThrow(compRes, "cup")?.scoring_model === "match_play";

  return async (evenShareFallback, allMatches, freshOutcomes, onFailure) => {
    // Fresh outcomes override stale results for the matches we just processed.
    const resultByMatch = new Map<string, "a_win" | "b_win" | "halve" | null>();
    for (const m of allMatches) {
      resultByMatch.set(
        m.id as string,
        (m.result as "a_win" | "b_win" | "halve" | null) ?? null
      );
    }
    for (const o of freshOutcomes) {
      resultByMatch.set(o.matchId, o.result);
    }

    // Fold `resultByMatch`'s fresh-outcome overrides onto each row before handing
    // off to the pure tally — `tallyMatchAwards` reads `m.result` verbatim, so the
    // override has to be applied here, once, rather than duplicated inside it.
    const withFreshResults = allMatches.map((m) => ({
      ...m,
      result: resultByMatch.get(m.id as string) ?? null,
    }));
    const teamPoints = new Map(
      Object.entries(tallyMatchAwards(withFreshResults, sideTeam, evenShareFallback))
    );

    // Every team IN THE GAME gets a row — including one that won NOTHING. In a
    // Match Play cup that is both teams, always; in a points race it is the teams
    // a paired side resolves to, and a team in no match gets NO row (PR 5,
    // `teamsInGame`: a 0 means played and lost, a missing row means wasn't in it).
    //
    // History: this was EVERY team in the competition, which in a points race
    // banked a scored 0 for a team that never played. And before that it was the
    // teams in the AWARDS, which failed as below — so what matters is not which
    // set, but that an empty one never reaches the write.
    //
    // This used to build the row set from `teamPoints`, i.e. from the AWARDS, and a
    // team only enters that map by winning or halving. Two failures followed, both
    // seen in production:
    //   · a shut-out team got no row at all (a decisive 1v1 wrote ONE team row);
    //   · when NO side resolved to a team — an unassigned roster, so every match
    //     hit the `!aTeam || !bTeam` skip — the map came out empty, and an empty
    //     `rows` under this entity_type-scoped write DELETED the game's existing
    //     team rows and inserted nothing. `writeGameResults` reports that as
    //     success (an empty write is not an error), so nothing threw and the board
    //     read 0–0 while the game's own scoreboard stayed correct.
    // Deriving the row set from the TEAMS instead makes both unrepresentable.
    //
    // `position` stays null deliberately. A per_match game's cup points ARE its
    // match points — `competitionLeaderboard.ts` builds a synthetic distribution
    // that passes them straight through — so ranking here would collapse 4½–3½ and
    // 7–1 into the same 1st/2nd and discard the margin the model exists to
    // preserve. `raw_score` is NUMERIC (migration 048) and genuinely carries the
    // halves.
    const teamIds = teamsInGame(allMatches, sideTeam, compTeamIds, isMatchPlayCup);

    // No team in the game (no teams, or — in a points race — no paired side
    // resolves to a team; a failed read threw before this was returned) → there
    // is nothing to say about this game, and an empty scoped write is
    // destructive rather than neutral: it would delete whatever team rows
    // already exist. Leave them alone.
    if (teamIds.length === 0) return;

    const rows = teamIds.map((teamId) => ({
      id: crypto.randomUUID(),
      entity_id: teamId,
      entity_type: "team" as const,
      raw_score: teamPoints.get(teamId) ?? 0,
      position: null as number | null,
      // POINTS. The tally IS the result of the contest — there is no schedule to
      // rank against, which is why `position` is null rather than unset.
      value_kind: "points" as const,
      competition_points_earned: null as null,
    }));
    await writeGameResults(supabase, {
      gameId,
      scope: { kind: "entity_type", entityType: "team" },
      rows,
      onFailure,
    });
  };
}
