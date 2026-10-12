/**
 * THE STANDINGS ROWS of a points tournament (PR 9c-2) — teams, or in a
 * tournament of individuals its people — as one pure model, so ranking, the
 * bar's two segments and the game-by-game breakdown are testable without a DOM
 * and the teamed and teamless boards cannot drift into two answers.
 *
 *  - BANKED is what finished games paid (`unitTotals`). It decides the order and
 *    the rank: a projection is "if today holds", not a result.
 *  - PROJECTED is what live games would add if they ended now (the 9c-1 arms,
 *    `projections`). It is drawn after the banked segment, hatched, and never
 *    moves anyone up or down.
 *  - NO POINTS YET — a unit with no finished result (`hasResult: false`) has no
 *    rank and sorts last. Never "0", which would say it played and scored
 *    nothing (ruling 30).
 *  - The bars share ONE scale: the largest banked + projected on the board, so a
 *    team's hatched segment can reach past the leader's solid one.
 *
 * There is no game-by-game breakdown here. It was built (ruling 4) and dropped on
 * Zach's 9c-2 look: the completed TILES are the game-by-game view, one row per
 * game with the teams in fixed columns, and the projected total is on the bar.
 */

export interface StandingsUnit {
  id: string;
  /** What the row reads: a team's SHORT name (a label slot), a person's name. */
  label: string;
  /** A team's colour; null for a person. */
  color: string | null;
  hasResult: boolean;
}

export interface StandingsRow {
  id: string;
  label: string;
  color: string | null;
  banked: number;
  /** Σ of this unit's live-game projections; 0 when nothing is live for it. */
  projected: number;
  hasResult: boolean;
  /** Competition ranking (1, 2, 2, 4) on BANKED; null = no points yet. */
  rank: number | null;
  isViewer: boolean;
  /** The two bar segments as % of the shared scale. */
  bankedPct: number;
  projectedPct: number;
}

export function standingsRows(p: {
  units: StandingsUnit[];
  unitTotals: Record<string, number>;
  /** gameId → unitId → projected points, live games only. */
  projections: Record<string, Record<string, number>>;
  /** The viewer's unit: their team, or in a teamless race themselves. */
  viewerUnitId: string | null | undefined;
}): StandingsRow[] {
  const projectedOf = (unitId: string) =>
    Object.values(p.projections).reduce((sum, byUnit) => sum + Math.max(0, byUnit[unitId] ?? 0), 0);

  const base = p.units.map((u) => ({
    u,
    banked: u.hasResult ? p.unitTotals[u.id] ?? 0 : 0,
    projected: projectedOf(u.id),
  }));

  const scored = base
    .filter((r) => r.u.hasResult)
    .sort((a, b) => b.banked - a.banked || a.u.label.localeCompare(b.u.label));
  const waiting = base
    .filter((r) => !r.u.hasResult)
    .sort((a, b) => b.projected - a.projected || a.u.label.localeCompare(b.u.label));

  const rankOf = new Map<string, number>();
  scored.forEach((r, i) => {
    const prev = scored[i - 1];
    rankOf.set(r.u.id, prev && prev.banked === r.banked ? rankOf.get(prev.u.id)! : i + 1);
  });

  const scale = Math.max(0, ...base.map((r) => r.banked + r.projected));
  const pct = (n: number) => (scale > 0 ? (n / scale) * 100 : 0);

  return [...scored, ...waiting].map((r) => ({
    id: r.u.id,
    label: r.u.label,
    color: r.u.color,
    banked: r.banked,
    projected: r.projected,
    hasResult: r.u.hasResult,
    rank: rankOf.get(r.u.id) ?? null,
    isViewer: p.viewerUnitId != null && r.u.id === p.viewerUnitId,
    bankedPct: pct(r.banked),
    projectedPct: pct(r.projected),
  }));
}

/**
 * A finished game's result as a ROW OF TILES (9c-2): one per team, in the board's
 * FIXED team order — never re-sorted, so each team is a column you can scan down
 * the completed list. `null` when the game paid nobody anything: the row says
 * "No points" instead (the Cornhole case, a finished game with no payout set).
 */
export interface ResultTile {
  teamId: string;
  /** Null = this team has no result in the game (not in it). */
  points: number | null;
  /** Holds the most points — a tie for most shares it. */
  winner: boolean;
}

export function resultTiles(teamIds: string[], cells: Map<string, { points: number }> | undefined): ResultTile[] | null {
  const points = teamIds.map((id) => cells?.get(id)?.points ?? null);
  const max = Math.max(...points.map((v) => v ?? 0));
  if (!(max > 0)) return null;
  return teamIds.map((teamId, i) => ({ teamId, points: points[i], winner: points[i] === max }));
}
