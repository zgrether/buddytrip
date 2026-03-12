/**
 * Scoring utilities for competition results.
 *
 * Computes team scores from round results and side events.
 */

export interface TeamScore {
  teamId: string;
  roundPoints: number;
  sidePoints: number;
  totalPoints: number;
}

export interface RoundResult {
  roundId: string;
  pointsAvailable: number;
  // teamPoints: { [teamId]: points earned }
  teamPoints: Record<string, number>;
}

export interface SideEventScore {
  sideEventId: string;
  result: Record<string, number>; // { [teamId]: points }
}

/**
 * Compute aggregate team scores from round results and side events.
 */
export function computeScores(
  teamIds: string[],
  roundResults: RoundResult[],
  sideEvents: SideEventScore[]
): TeamScore[] {
  const scores = new Map<string, { roundPoints: number; sidePoints: number }>();

  for (const teamId of teamIds) {
    scores.set(teamId, { roundPoints: 0, sidePoints: 0 });
  }

  // Tally round points
  for (const round of roundResults) {
    for (const [teamId, points] of Object.entries(round.teamPoints)) {
      const score = scores.get(teamId);
      if (score) {
        score.roundPoints += points;
      }
    }
  }

  // Tally side event points
  for (const side of sideEvents) {
    for (const [teamId, points] of Object.entries(side.result)) {
      const score = scores.get(teamId);
      if (score) {
        score.sidePoints += points;
      }
    }
  }

  return teamIds.map((teamId) => {
    const s = scores.get(teamId)!;
    return {
      teamId,
      roundPoints: s.roundPoints,
      sidePoints: s.sidePoints,
      totalPoints: s.roundPoints + s.sidePoints,
    };
  });
}
