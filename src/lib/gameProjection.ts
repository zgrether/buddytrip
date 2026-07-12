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
 * its real value, exactly as the finish path awards it.
 */
export function rollupMatchPlay(matches: ProjMatch[], pointsPerMatch: number): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (teamId: string | null, n: number) => {
    if (teamId) out[teamId] = (out[teamId] ?? 0) + n;
  };
  for (const m of matches) {
    if (!m.started) continue; // not started → 0
    const value = m.points ?? pointsPerMatch; // A2b: per-match override wins
    if (m.leader === "A") add(m.aTeamId, value);
    else if (m.leader === "B") add(m.bTeamId, value);
    else {
      // all-square, in progress → halved
      add(m.aTeamId, value / 2);
      add(m.bTeamId, value / 2);
    }
  }
  return out;
}
