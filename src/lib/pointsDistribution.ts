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

/**
 * The distribution a game ACTUALLY pays by — with the winner-take-all default
 * made explicit.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 * A bracket with no distribution set awarded NOTHING: no value in the final's
 * header, no projection on the board, and no points rolled up. Setting any
 * second-place value fixed all three at once, which is the tell that they share
 * one input.
 *
 * They did. Three separate call sites each wrote `isPlacement(d) ? d.values : []`
 * — the server roll-up (`competitionLeaderboard`), the client projection
 * (`NonGolfGameView`) and the match-header stakes (`bracketStakes`) — and an
 * EMPTY distribution makes `placementPoints` award 0 to everyone. The bracket
 * branch also returns before the winner-take-all flatten below it, so nothing
 * downstream supplied the default either.
 *
 * ── Why `[total]` is not a guess ───────────────────────────────────────────
 * The code that shipped this called the empty array deliberate, on the grounds
 * that inventing a payout would be "a bracket-specific guess about what the
 * organizer meant". It isn't a guess: it is what every OTHER format already
 * does with a null distribution (the head-to-head arm three lines away flattens
 * to `[total, 0]`), and #928 states the rule directly — "a one-place
 * distribution is an ordinary bracket and the cheapest path through". A game
 * that is worth N points and has one winner pays N to the winner. Awarding zero
 * is the surprising answer, not the safe one.
 *
 * ── One helper, because three copies is how they drifted ───────────────────
 * Every consumer of a game's payout calls this. A caller that writes the
 * ternary itself is re-introducing the bug in one of the three places, and the
 * next reader has no way to tell which of them is authoritative.
 */
export function effectiveDistribution(
  distribution: PointsDistribution | null | undefined,
  pointsTotal: number | null | undefined
): number[] {
  if (isPlacement(distribution)) return distribution.values;
  // No authored split → winner takes the lot. A game worth nothing stays empty,
  // so an unconfigured game still reads as "no payout" rather than "0 to first".
  const total = Number(pointsTotal ?? 0);
  return total > 0 ? [total] : [];
}
