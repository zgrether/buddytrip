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

export interface ScoreSummary {
  teamScores: TeamScore[];
  remaining: number;
}

export interface RoundResult {
  roundId: string;
  pointsAvailable: number;
  // teamPoints: { [teamId]: points earned }
  teamPoints: Record<string, number>;
}

export interface SideEventScore {
  sideEventId: string;
  pointsAvailable: number;
  result: Record<string, number>; // { [teamId]: points }
}

export interface RoundInfo {
  roundId: string;
  pointsAvailable: number;
  hasResults: boolean;
}

export interface SideEventInfo {
  sideEventId: string;
  pointsAvailable: number;
  isComplete: boolean;
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

/**
 * Compute remaining points — sum of points from rounds without results
 * and side events without results.
 */
export function computeRemaining(
  rounds: RoundInfo[],
  sideEvents: SideEventInfo[]
): number {
  let remaining = 0;
  for (const r of rounds) {
    if (!r.hasResults) remaining += r.pointsAvailable;
  }
  for (const s of sideEvents) {
    if (!s.isComplete) remaining += s.pointsAvailable;
  }
  return remaining;
}

/**
 * Full score summary — scores + remaining points.
 */
export function computeScoreSummary(
  teamIds: string[],
  roundResults: RoundResult[],
  sideEvents: SideEventScore[],
  allRounds: RoundInfo[],
  allSideEvents: SideEventInfo[]
): ScoreSummary {
  return {
    teamScores: computeScores(teamIds, roundResults, sideEvents),
    remaining: computeRemaining(allRounds, allSideEvents),
  };
}
