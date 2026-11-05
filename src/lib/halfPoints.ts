import { evenShare, pointsDivideByMatchRows } from "./pointsDistribution";

/**
 * Does this cup count in halves? (Zach's half-points rule, 2026-10-22, and his
 * look on #1694.) A ½ means one thing to a golfer: a halved match worth 1
 * point. So the board writes "8½" only on a Cup where every game pays exactly
 * 1 point per match, and only on its totals, projected totals, target and
 * match result cells. Everywhere else, and on any other cup, a fraction is a
 * decimal with trailing zeros dropped (`fmtPts`).
 *
 * A game counts against it unless it awards match by match (match play, or a
 * non-golf game played as Matches) and every one of its paired matches is
 * worth 1. Rack pays by slot and pick'em by its own schedule, so either one
 * makes the answer no. A game with no paired matches yet (unpaired, or hidden
 * from this viewer while in setup) cannot say what a match is worth, so it
 * neither qualifies nor disqualifies the cup; at least one game must.
 *
 * Pure, so the board's server read and its tests ask the same question.
 */
export interface HalfPointsGame {
  gameTypeId: string | null;
  competitionFormat: string | null;
  /** The owner-set total (`points_total`), or null on a legacy game. */
  pointsTotal: number | null;
  /** A legacy game's stored per-match value, used only with no total. */
  legacyValue: number | null;
  /** Each PAIRED match's own value (`point_value`), or null for the even share. */
  pairedMatchValues: ReadonlyArray<number | null>;
}

export function cupCountsInHalves(scoringModel: string | null, games: ReadonlyArray<HalfPointsGame>): boolean {
  if (scoringModel !== "match_play") return false;
  let priced = 0;
  for (const g of games) {
    if (g.gameTypeId === "gtt_pickem" || !pointsDivideByMatchRows(g.gameTypeId, g.competitionFormat)) return false;
    const values = g.pairedMatchValues;
    if (values.length === 0) continue;
    const overrides = values.filter((v): v is number => v != null);
    const share = g.pointsTotal == null ? g.legacyValue ?? 0 : evenShare(g.pointsTotal, overrides, values.length);
    if (values.some((v) => (v ?? share) !== 1)) return false;
    priced++;
  }
  return priced > 0;
}
