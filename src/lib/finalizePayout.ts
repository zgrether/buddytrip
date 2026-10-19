import { placementPoints } from "./competitionPlacement";

/**
 * What a game will PAY when it is finalized, shown beside "Save results" before
 * it is final (#1639): each finisher's points, and any share of the split that
 * cannot be paid, with its reason.
 *
 * Pure and client-safe, built on the SAME `placementPoints` the cup's roll-up
 * uses (CLAUDE.md #8), fed the SAME ranked rows finalize writes, so the preview
 * and the result cannot disagree.
 *
 * `paysNothing` is the #1455 case: points are on offer and none would be paid
 * (nothing was played). Finalize still goes through, but asks first.
 */

export interface PayoutLine {
  /** The team (or, in a teamless race, the person) being paid. */
  unitId: string;
  /** 1-based finishing place; tied units share the group's first place. */
  place: number;
  points: number;
}

/** A place in the split that no finisher can occupy, so it is never paid. */
export interface UnpaidPlace {
  place: number;
  points: number;
  /** How many units finished, for the reason ("only 2 teams finished"). */
  finishers: number;
}

export interface FinalizePayout {
  lines: PayoutLine[];
  unpaid: UnpaidPlace[];
  /** What the lines add up to. */
  paid: number;
  /** Points are on offer, and none would be paid. */
  paysNothing: boolean;
}

/**
 * A placement game: `ranked` is what finalize writes, one row per finisher with
 * its 1-based `position` (low wins, ties share a position). `values` is the
 * effective split (`effectiveDistribution`).
 */
export function placementPayout(values: number[], ranked: { unitId: string; position: number }[]): FinalizePayout {
  const byUnit = placementPoints(
    values,
    ranked.map((r) => ({ entityId: r.unitId, value: r.position })),
    "low_wins"
  );
  const lines: PayoutLine[] = [...ranked]
    .sort((a, b) => a.position - b.position || a.unitId.localeCompare(b.unitId))
    .map((r) => ({ unitId: r.unitId, place: r.position, points: byUnit.get(r.unitId) ?? 0 }));

  const finishers = ranked.length;
  const unpaid: UnpaidPlace[] = values
    .slice(finishers)
    .map((points, i) => ({ place: finishers + i + 1, points, finishers }))
    .filter((u) => u.points > 0);

  const paid = lines.reduce((sum, l) => sum + l.points, 0);
  const offered = values.reduce((sum, v) => sum + (v || 0), 0);
  return { lines, unpaid, paid, paysNothing: offered > 0 && paid === 0 };
}

