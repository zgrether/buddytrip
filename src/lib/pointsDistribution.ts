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
