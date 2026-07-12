/**
 * Tagged points-distribution shapes (D1 follow-on).
 *
 * `placement` — ranked payout: 1st gets values[0], 2nd gets values[1], etc.
 *   Averaged ties (two teams tied for 3rd each get (values[2]+values[3])/2).
 *   Consumed by competitionPlacement.ts placementPoints() unchanged.
 *
 * `per_match` — each decided match awards `value` pts to the winning team;
 *   a halved match awards `value/2` to each side. Team total = Σ won (+ halves).
 *   The adapter in computeMatchPlayResults writes entity_type='team' raw_score
 *   rows; computeCompetitionLeaderboard builds a synthetic placement distribution
 *   from those so rollUp() consumes both adapter kinds identically.
 */
export type PlacementDistribution = { type: "placement"; values: number[] };
export type PerMatchDistribution = { type: "per_match"; value: number };
export type PointsDistribution = PlacementDistribution | PerMatchDistribution;

export function isPerMatch(d: unknown): d is PerMatchDistribution {
  return (
    typeof d === "object" &&
    d !== null &&
    (d as PerMatchDistribution).type === "per_match"
  );
}

export function isPlacement(d: unknown): d is PlacementDistribution {
  return (
    typeof d === "object" &&
    d !== null &&
    (d as PlacementDistribution).type === "placement"
  );
}

/**
 * A2b — the derived EVEN SHARE for a match-play game's NON-overridden matches:
 *   (total − Σ overrides) ÷ (matchCount − overrideCount).
 *
 * `overrides` is the list of explicit per-match `game_matches.point_value`s; every
 * other match splits the remainder equally. The Total Points model persists ONLY
 * the overrides — this even share is derived from live inputs (never snapshotted
 * per-match) and written to `points_distribution.value`, which the award sites read
 * as the fallback (`point_value ?? points_distribution.value`).
 *
 * Returns 0 when every match is overridden (no even share to spread) or there are no
 * matches. NOT rounded — honest fractions (16 ÷ 7 = 2.285…) are surfaced in the UI,
 * never silently rounded, so the persisted award value and the displayed value agree.
 */
export function evenShare(total: number, overrides: number[], matchCount: number): number {
  const nonOverridden = matchCount - overrides.length;
  if (nonOverridden <= 0) return 0;
  const remainder = total - overrides.reduce((s, v) => s + v, 0);
  return remainder / nonOverridden;
}
