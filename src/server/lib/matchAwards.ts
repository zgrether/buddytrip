import type { SupabaseClient } from "@supabase/supabase-js";
import { writeGameResults, type WriteFailureMode } from "./writeGameResults";

/**
 * The per-match TEAM AWARD — the half of match-play scoring that knows nothing
 * about holes.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 *
 * It lived inside `matchPlay.ts`, which is correct for golf and wrong the moment
 * a second format needs it. Non-golf **Matches** (`competition_format = 'matches'`)
 * declares each match's result outright — there is no hole sequence to derive one
 * from — so it skips the entire first half of that file and reuses only this.
 *
 * Left where it was, every non-golf finalize would `import … from "./matchPlay"`,
 * and the next reader would reasonably conclude that Matches IS match play. It
 * is not: they share an AWARD RULE (win takes the match's value, a draw splits
 * it) and share nothing else. A shared rule belongs in a module named for the
 * rule.
 *
 * ── What it reads, and what it deliberately does not ───────────────────────
 *
 * Only `game_matches.result` + `point_value`, plus the roster tables needed to
 * resolve a side to its cup team. No `score_entries`, no `match_hole_outcomes`,
 * no scorecard schema, no stroke index, no handicaps. That is what makes it
 * servable by a format with no holes at all — and it was already true before the
 * extraction, which is why this is a move rather than a rewrite.
 */

/** A `game_matches.side_a`/`side_b` JSONB ref. A 1v1 side is a user; a 2v2 side
 *  is a minted `play_group` (CLAUDE.md #27 — a side is not a person). */
interface SideRef {
  type: string;
  id: string;
}

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

/**
 * Pure: the award rule ITSELF, with no DB in it — win takes the match's value,
 * a draw splits it. Extracted so the persisted write below and the board's
 * LIVE projection (`liveProjection.ts`'s Matches branch) run the exact same
 * accumulation and can't disagree about what an in-progress board should show
 * versus what `games.finish` will eventually write (CLAUDE.md #8's split,
 * applied to this award instead of to a whole game's scoring). `sideTeam` is
 * injected rather than resolved in here because the two callers build it from
 * different reads (this file's DB queries vs. `liveProjection`'s already-
 * bulk-fetched roster) — the resolution differs, the arithmetic must not.
 */
export function tallyMatchAwards(
  matches: { side_a: unknown; side_b: unknown; result?: unknown; point_value?: unknown }[],
  sideTeam: (s: SideRef) => string | undefined,
  evenShareFallback: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of matches) {
    const result = m.result as "a_win" | "b_win" | "halve" | null;
    if (!result) continue;
    const a = m.side_a as SideRef | null;
    const b = m.side_b as SideRef | null;
    if (!a?.id || !b?.id) continue;
    const aTeam = sideTeam(a);
    const bTeam = sideTeam(b);
    if (!aTeam || !bTeam) continue;

    // A2b award rule: this match's own override, else the even share.
    const value = (m.point_value as number | null) ?? evenShareFallback;
    if (result === "a_win") {
      out[aTeam] = (out[aTeam] ?? 0) + value;
    } else if (result === "b_win") {
      out[bTeam] = (out[bTeam] ?? 0) + value;
    } else {
      // halve — each side gets half
      out[aTeam] = (out[aTeam] ?? 0) + value / 2;
      out[bTeam] = (out[bTeam] ?? 0) + value / 2;
    }
  }
  return out;
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
 *  awards its own value. */
export async function writeTeamMatchPoints(
  supabase: SupabaseClient,
  gameId: string,
  competitionId: string,
  evenShareFallback: number,
  allMatches: { id: unknown; side_a: unknown; side_b: unknown; result: unknown; point_value?: unknown }[],
  freshOutcomes: DecidedMatch[],
  onFailure?: WriteFailureMode
) {
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

  // user → team for this competition.
  const { data: assignments } = await supabase
    .from("team_assignments")
    .select("user_id, team_id")
    .eq("competition_id", competitionId);
  const userTeam = new Map<string, string>();
  for (const a of assignments ?? []) {
    userTeam.set(a.user_id as string, a.team_id as string);
  }

  // play_group → team (2v2): a side is a pair, so resolve its team via a member.
  // Both partners are on the same team in a two-team competition. Empty for 1v1.
  const { data: pgMembers } = await supabase
    .from("game_participants")
    .select("user_id, play_group_id")
    .eq("game_id", gameId);
  const pgTeam = new Map<string, string>();
  for (const gp of pgMembers ?? []) {
    const pg = gp.play_group_id as string | null;
    if (!pg || pgTeam.has(pg)) continue;
    const team = userTeam.get(gp.user_id as string);
    if (team) pgTeam.set(pg, team);
  }
  // A side resolves to its team via the user map (1v1) or the play_group map (2v2).
  const sideTeam = (s: SideRef): string | undefined =>
    s.type === "play_group" ? pgTeam.get(s.id) : userTeam.get(s.id);

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

  // EVERY team in the competition gets a row — including one that won NOTHING.
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
  const { data: compTeams } = await supabase
    .from("teams")
    .select("id")
    .eq("competition_id", competitionId);
  const teamIds = (compTeams ?? []).map((t) => t.id as string);

  // No teams (or the read failed) → there is nothing to say about this game, and
  // an empty scoped write is destructive rather than neutral: it would delete
  // whatever team rows already exist. Leave them alone.
  if (teamIds.length === 0) return;

  const rows = teamIds.map((teamId) => ({
    id: crypto.randomUUID(),
    entity_id: teamId,
    entity_type: "team" as const,
    raw_score: teamPoints.get(teamId) ?? 0,
    position: null as number | null,
    competition_points_earned: null as null,
  }));
  await writeGameResults(supabase, {
    gameId,
    scope: { kind: "entity_type", entityType: "team" },
    rows,
    onFailure,
  });
}
