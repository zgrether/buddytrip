import { effectiveDistribution, evenShare, isPerMatch, pointsDivideByMatchRows, type PointsDistribution } from "@/lib/pointsDistribution";
import { isBracketGame, isPickemGame } from "@/lib/resultStrategy";
import type { ClinchAward, ClinchGame } from "@/lib/pointsClinch";
import type { BoardInputs } from "./boardGames";

/**
 * A points cup's unbanked games, in the shape `pointsClinch` reads (spec §1),
 * built from what the board has already loaded: no new reads.
 *
 * Unbanked is `status`, the same test as `bankedOnlyWhenFinished`, so a game
 * reopened for a correction stays banked and its clinch stands. The board and
 * the clinch push both come through here, so the two cannot disagree about who
 * has clinched.
 *
 * Under a member's RLS a game in setup hides its matches. That cannot change
 * the answer, because a game that has not started uses no pairing at all.
 */

interface ClinchGameRow {
  id: unknown;
  name?: unknown;
  status?: unknown;
  game_type_id?: unknown;
  competition_format?: unknown;
  points_total?: unknown;
  points_distribution?: unknown;
}

type ClinchInputs = Pick<
  BoardInputs,
  "startedByGame" | "pairedMatchesByGame" | "entrantTeamsByGame"
>;

function awardFor(g: ClinchGameRow, inputs: ClinchInputs, unitOfUser: (userId: string) => string | null): ClinchAward {
  const id = g.id as string;
  const gameTypeId = (g.game_type_id as string | null) ?? null;
  const format = (g.competition_format as string | null) ?? null;
  const pointsTotal = (g.points_total as number | null) ?? null;
  const distribution = (g.points_distribution as PointsDistribution | null) ?? null;
  const started = inputs.startedByGame.has(id);
  const values = effectiveDistribution(distribution, pointsTotal);

  if (isBracketGame(gameTypeId, format)) {
    const entrants = inputs.entrantTeamsByGame.get(id) ?? [];
    const entrantsByUnit: Record<string, number> = {};
    for (const unit of entrants) if (unit) entrantsByUnit[unit] = (entrantsByUnit[unit] ?? 0) + 1;
    return {
      kind: "bracket",
      values,
      total: pointsTotal ?? values.reduce((a, b) => a + b, 0),
      fieldSize: entrants.length,
      entrantsByUnit: started ? entrantsByUnit : null,
    };
  }

  if (pointsDivideByMatchRows(gameTypeId, format) && !isPickemGame(gameTypeId, format)) {
    const rows = inputs.pairedMatchesByGame.get(id) ?? [];
    const legacyValue = isPerMatch(distribution) ? distribution.value : null;
    const total = pointsTotal ?? (legacyValue ?? 0) * rows.length;
    const overrides = rows.map((m) => m.pointValue).filter((v): v is number => v != null);
    const share = evenShare(total, overrides, rows.length);
    return {
      kind: "matches",
      total,
      matches: started
        ? rows.map((m) => ({
            unitIds: [...new Set(m.memberIds.map(unitOfUser).filter((u): u is string => u != null))],
            value: m.pointValue ?? share,
          }))
        : null,
    };
  }

  return { kind: "placement", values };
}

/** One game as the math reads it, banked or not: the board also asks what the
 *  game banked last put out. */
export function clinchGame(g: ClinchGameRow, inputs: ClinchInputs, unitOfUser: (userId: string) => string | null): ClinchGame {
  return { id: g.id as string, name: (g.name as string | null) ?? "", award: awardFor(g, inputs, unitOfUser) };
}

export function clinchGames(
  games: readonly ClinchGameRow[],
  inputs: ClinchInputs,
  unitOfUser: (userId: string) => string | null
): ClinchGame[] {
  return games
    .filter((g) => g.status !== "complete" && g.status !== "dropped")
    .map((g) => clinchGame(g, inputs, unitOfUser));
}
