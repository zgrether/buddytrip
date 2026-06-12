/**
 * Competition placement spine + clinch math (Slice D1 §5–§6) — PURE, client-safe.
 * No server/DB deps, so the live leaderboard (client) and any persisted roll-up
 * use the SAME functions and can't diverge (CLAUDE.md enforced pattern #8).
 *
 * The spine is universal: EVERY game — engine (computes `game_results`) or
 * manual (an organizer enters `game_results`) — rolls up through the same path:
 *
 *   game_results → per-team standing (5a) → ranking → distribution points (5b)
 *   → Σ across live games → points-available, per-team totals, win number (6).
 *
 * Placement points are ALWAYS derived (never stored for engine games); manual
 * games store their *standings* (entered), but points are still derived here.
 */

/** A team's standing within one game: the value to rank by + the direction. */
export interface Standing {
  entityId: string;
  /** The number to sort on (net-to-par, points, position…). */
  value: number;
}
/** "low_wins" → lower value is better (net-to-par, position); "high_wins" → higher (points). */
export type Direction = "low_wins" | "high_wins";

/** One game's contribution to the roll-up. A Phase-1 shell has standings: [] and
 *  still contributes points-available (sum of distribution[0..numTeams-1]). */
export interface LiveGame {
  id: string;
  /** Ordered points by place, e.g. [9,6,4,2]. Null/empty → contributes nothing. */
  distribution: number[] | null;
  /** Teams in the competition that this game ranks (numTeams for points-available). */
  numTeams: number;
  /** Per-team standings once results exist; empty before any are entered/computed. */
  standings: Standing[];
  direction: Direction;
}

/** distribution[i] with out-of-range → 0 (teams beyond the distribution earn 0). */
function dist(distribution: number[], i: number): number {
  return i >= 0 && i < distribution.length ? distribution[i] : 0;
}

/**
 * §5b — standings → ranking → distribution points, with AVERAGED ties.
 * Teams tied at the same standing occupy consecutive places p..q (1-based) and
 * each gets `sum(distribution[p..q]) / groupSize`. Teams beyond the distribution
 * get 0. Sum awarded is invariant under ties (averaging preserves it).
 *
 * Example (the grid): distribution [9,6,4,2], two teams tie for 3rd →
 * places 1,2,(3,4) → 9, 6, (4+2)/2=3, 3 → the 9,6,3,3 row.
 */
export function placementPoints(
  distribution: number[],
  standings: Standing[],
  direction: Direction
): Map<string, number> {
  const out = new Map<string, number>();
  if (standings.length === 0) return out;

  const sorted = [...standings].sort((a, b) =>
    direction === "low_wins" ? a.value - b.value : b.value - a.value
  );

  let i = 0;
  while (i < sorted.length) {
    // Collect the tie group sharing this standing value.
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
    const groupSize = j - i + 1;
    // Places i+1 .. j+1 (1-based) → distribution indices i .. j (0-based).
    let pot = 0;
    for (let k = i; k <= j; k++) pot += dist(distribution, k);
    const share = pot / groupSize;
    for (let k = i; k <= j; k++) out.set(sorted[k].entityId, share);
    i = j + 1;
  }
  return out;
}

/**
 * Like placementPoints but also returns each team's PLACE (1-based; tied teams
 * share the group's starting place — two tied for 3rd are both place 3). For the
 * scoreboard grid cell ("3rd · 3 pts"). Same averaging as placementPoints.
 */
export function placementDetail(
  distribution: number[],
  standings: Standing[],
  direction: Direction
): Map<string, { place: number; points: number }> {
  const out = new Map<string, { place: number; points: number }>();
  if (standings.length === 0) return out;
  const sorted = [...standings].sort((a, b) =>
    direction === "low_wins" ? a.value - b.value : b.value - a.value
  );
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
    const groupSize = j - i + 1;
    let pot = 0;
    for (let k = i; k <= j; k++) pot += dist(distribution, k);
    const share = pot / groupSize;
    for (let k = i; k <= j; k++) out.set(sorted[k].entityId, { place: i + 1, points: share });
    i = j + 1;
  }
  return out;
}

/** Sum awarded by one game = sum(distribution[0 .. numTeams-1]). Invariant under
 *  ties (5b averaging preserves it). A shell with a distribution but no results
 *  still contributes this to points-available. */
export function awardedForGame(distribution: number[] | null, numTeams: number): number {
  if (!distribution || distribution.length === 0 || numTeams <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < numTeams; i++) sum += dist(distribution, i);
  return sum;
}

export interface RollUp {
  /** Σ over live games of awardedForGame. */
  pointsAvailable: number;
  /** entityId → Σ distribution points across live games. */
  teamTotals: Map<string, number>;
  /** The number a team must REACH to clinch (see winThreshold). */
  winNumber: number;
  /** entityId → winNumber − currentPoints (≤0 means clinched). */
  pointsToClinch: Map<string, number>;
}

/**
 * §6 — the win number. Default: clinch by EXCEEDING half (> half). The smallest
 * 0.5-step strictly above half. e.g. available 28 → half 14 → 14.5; available 27
 * → 13.5 → 14.
 *
 * Retain case: a designated `defendingTeamId` clinches at EXACTLY half (a tie
 * retains) — so its win number is half itself (rounded up to a 0.5 step if half
 * isn't one). Everyone else still needs > half. We expose ONE win number (the
 * general > half) plus a per-team clinch check that honors the defender.
 */
export function winThreshold(pointsAvailable: number, defending: boolean): number {
  const half = pointsAvailable / 2;
  // Round to the nearest 0.5 step (points come in halves via averaged ties).
  if (defending) {
    // Smallest 0.5-step ≥ half (tie at exactly half retains).
    return Math.ceil(half * 2) / 2;
  }
  // Smallest 0.5-step strictly > half.
  return (Math.floor(half * 2) + 1) / 2;
}

/**
 * The full roll-up over LIVE (non-dropped) games. Caller passes only live games
 * — dropping/restoring a game changes the set, which is exactly why the win
 * number recomputes (§4): it is derived here, never stored.
 *
 * `teamIds` is the full competition roster so a team with zero points still
 * appears (and so points-to-clinch is defined for everyone).
 */
export function rollUp(
  liveGames: LiveGame[],
  teamIds: string[],
  opts?: { defendingTeamId?: string | null }
): RollUp {
  const teamTotals = new Map<string, number>(teamIds.map((id) => [id, 0]));
  let pointsAvailable = 0;

  for (const g of liveGames) {
    pointsAvailable += awardedForGame(g.distribution, g.numTeams);
    if (!g.distribution || g.standings.length === 0) continue;
    const pts = placementPoints(g.distribution, g.standings, g.direction);
    for (const [entityId, p] of pts) {
      teamTotals.set(entityId, (teamTotals.get(entityId) ?? 0) + p);
    }
  }

  const generalWin = winThreshold(pointsAvailable, false);
  const defenderId = opts?.defendingTeamId ?? null;
  const defenderWin = winThreshold(pointsAvailable, true);

  const pointsToClinch = new Map<string, number>();
  for (const id of teamIds) {
    const need = id === defenderId ? defenderWin : generalWin;
    pointsToClinch.set(id, need - (teamTotals.get(id) ?? 0));
  }

  // The headline win number is the general (>half) one; the defender's lower bar
  // is reflected only in its own pointsToClinch.
  return { pointsAvailable, teamTotals, winNumber: generalWin, pointsToClinch };
}
