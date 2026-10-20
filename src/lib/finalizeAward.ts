import { placementPoints } from "./competitionPlacement";

/**
 * What a game will AWARD when it is finalized, shown beside "Save results"
 * before it is final (#1639): each finisher's points, and any place in the
 * split no finisher can fill, with its reason.
 *
 * Points are AWARDED, never paid (CLAUDE.md glossary; `AWARD_WORD`).
 *
 * Pure and client-safe, built on the SAME `placementPoints` the cup's roll-up
 * uses (CLAUDE.md #8), fed the SAME ranked rows finalize writes, so the preview
 * and the result cannot disagree.
 *
 * `awardsNothing` is the #1455 case: points are on offer and none would be
 * awarded. Finalize still goes through, but asks first.
 */

export interface AwardLine {
  /** The team (or, in a teamless race, the person) awarded points. */
  unitId: string;
  /** 1-based finishing place; tied units share the group's first place. */
  place: number;
  points: number;
}

/** A place in the split that no finisher can occupy, so it is never awarded. */
export interface UnawardedPlace {
  place: number;
  points: number;
  /** How many units finished, for the reason ("only 2 teams finished"). */
  finishers: number;
}

export interface FinalizeAward {
  lines: AwardLine[];
  unawarded: UnawardedPlace[];
  /** What the lines add up to. */
  awarded: number;
  /** Points are on offer, and none would be awarded. */
  awardsNothing: boolean;
}

/**
 * A placement game: `ranked` is what finalize writes, one row per finisher with
 * its 1-based `position` (low wins, ties share a position). `values` is the
 * effective split (`effectiveDistribution`).
 */
export function placementAward(values: number[], ranked: { unitId: string; position: number }[]): FinalizeAward {
  const byUnit = placementPoints(
    values,
    ranked.map((r) => ({ entityId: r.unitId, value: r.position })),
    "low_wins"
  );
  const lines: AwardLine[] = [...ranked]
    .sort((a, b) => a.position - b.position || a.unitId.localeCompare(b.unitId))
    .map((r) => ({ unitId: r.unitId, place: r.position, points: byUnit.get(r.unitId) ?? 0 }));

  const finishers = ranked.length;
  const unawarded: UnawardedPlace[] = values
    .slice(finishers)
    .map((points, i) => ({ place: finishers + i + 1, points, finishers }))
    .filter((u) => u.points > 0);

  const awarded = lines.reduce((sum, l) => sum + l.points, 0);
  const offered = values.reduce((sum, v) => sum + (v || 0), 0);
  return { lines, unawarded, awarded, awardsNothing: offered > 0 && awarded === 0 };
}
