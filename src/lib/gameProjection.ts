/**
 * Game-page header PROJECTION rollup (#533) — pure, client-safe. This is a
 * PRESENTATION-LAYER sum of the results the scoreboard ALREADY has on the page
 * into per-team points; it calls NO scoring engine, fetches nothing, snapshots
 * nothing. "If this game ended right now, what does each team get?"
 *
 * N-team-aware: returns a per-team map `{ [teamId]: points }`, never a 2-team pair
 * (points cups run up to 8 teams). Rack reuses its own live projection and
 * non-golf sums its declared cells inline at the call site — only the match-play
 * rule needs a shared function, so that's what lives here (+ its tests).
 */

import { awardMatches, type MatchAwardResult } from "./gameAward";

/** One match's current on-page standing, as the scoreboard already shows it. */
export interface ProjMatch {
  /** The team on each side (null when a side isn't attributed to a team). */
  aTeamId: string | null;
  bTeamId: string | null;
  /** Who is currently up on net, or null when all-square OR not started. */
  leader: "A" | "B" | null;
  /** Has any hole been decided yet? An unstarted match projects to nothing. */
  started: boolean;
  /** A2b: this match's OWN points value (`game_matches.point_value`). When set it
   *  OVERRIDES the game's even-share `pointsPerMatch` for this match only; null/omit
   *  → the even share. So a "counts double" match is just a match carrying its own
   *  value — no separate multiplier. */
  points?: number | null;
}

/**
 * Match play (1v1 / 2v2) rollup — project each match's CURRENT standing to an
 * outcome and sum the points per team:
 *   - up (either side) → that side wins it → its team gets the match's points;
 *   - all-square but STARTED → halved → the points split (½ to each side's team);
 *   - not started → contributes nothing.
 * Teams beyond two accumulate independently (a points-cup 2v2 with N teams).
 *
 * A2b: each match is worth its own `points` when set (an override), else the game's
 * even-share `pointsPerMatch` — so an overridden ("counts double") match projects at
 * its real value, the same way the finish path awards it.
 *
 * That last clause used to read "exactly as the finish path awards it" and was
 * FALSE for a match with an unteamed side. It is true now because both paths
 * call one function; see `rollupMatchPlayDetailed` for what diverged.
 */
/**
 * Competition-total projection ("if today holds") — the FIRST rollup of projected
 * points to a competition total. Per team: banked (`teamTotals`) + Σ of that team's
 * live-game projections (the per-game `projections` the board already computes, Path A).
 * Summed SERVER-SIDE so one authoritative total rides the board payload and the hero
 * reads it directly — no client re-aggregation, no board-vs-client drift.
 *
 * `hasLive` = at least one game is live (the `projections` map is non-empty). This is
 * the tier-visibility gate — TRUE even when a live game projects 0 to a team (that team
 * shows a bare number, no pill), so it must reflect live-game PRESENCE, not any delta.
 *
 * Projections are awarded points (≥ 0), so each projected total ≥ its banked total →
 * every delta (projected − banked) is ≥ 0 and the pill is always ▲.
 */
export function projectedTeamTotals(
  teamTotals: Record<string, number>,
  projections: Record<string, Record<string, number>>,
  teamIds: string[],
): { totals: Record<string, number>; hasLive: boolean } {
  const totals: Record<string, number> = {};
  for (const id of teamIds) totals[id] = teamTotals[id] ?? 0;
  for (const perTeam of Object.values(projections)) {
    for (const [teamId, pts] of Object.entries(perTeam)) {
      totals[teamId] = (totals[teamId] ?? 0) + pts;
    }
  }
  return { totals, hasLive: Object.keys(projections).length > 0 };
}

export function rollupMatchPlay(matches: ProjMatch[], pointsPerMatch: number): Record<string, number> {
  return rollupMatchPlayDetailed(matches, pointsPerMatch).byTeam;
}

/**
 * The same rollup, keeping the count of started matches that can pay NOBODY.
 *
 * ── THIS FUNCTION USED TO DISAGREE WITH THE FINALIZE, AND SAID IT DIDN'T ────
 *
 * Its own doc comment claimed each match projects "exactly as the finish path
 * awards it". It did not. The old body added through
 * `(teamId, n) => { if (teamId) … }`, which silently DROPS an unteamed side and
 * credits the other one; the finalize's rule is `if (!aTeam || !bTeam) continue`
 * — pay nobody. So one match with one unassigned player projected points to a
 * team that the finalize would never pay, and the difference showed up as
 * points disappearing when the game was finalized.
 *
 * Both now call `awardMatches`. The rule lives in ONE place and this is an
 * adapter: it says what a match's CURRENT standing means (leading → that side
 * takes it, all-square but started → split, not started → nothing), and hands
 * that to the rule. The finalize's adapter says the same thing about a RECORDED
 * result. Neither can drift, because neither decides.
 */
export function rollupMatchPlayDetailed(
  matches: ProjMatch[],
  pointsPerMatch: number
): MatchAwardResult {
  return awardMatches(
    matches.map((m) => ({
      aTeamId: m.aTeamId,
      bTeamId: m.bTeamId,
      // A2b: per-match override wins over the game's even share.
      value: m.points ?? pointsPerMatch,
      outcome: !m.started ? null : m.leader === "A" ? "a" : m.leader === "B" ? "b" : "split",
    }))
  );
}
