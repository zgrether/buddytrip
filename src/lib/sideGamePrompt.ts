import { canBeSideGame } from "./gameTypes";
import { pairsFromRosters } from "./builderPool";

/**
 * Does going live ask "Nobody here is on a team, so this game can't award
 * points"? (#1668 look, item 3.)
 *
 * Only when ALL of these hold:
 *  - it is a FRESH go-live (scoring was off in the saved game). Re-enabling a
 *    game that was live is not the moment of the choice;
 *  - the game is in a competition WITH teams. A side game awards nothing by
 *    design, and a teamless race's units are people, so both are fine as they
 *    are;
 *  - the format can be a side game, the limit the move itself has (migration
 *    218). For any other format there is nothing to offer, and the finish-time
 *    backstop ("This game awards no points.") still asks;
 *  - someone is playing, and NOBODY playing is on a team.
 */
export function asksSideGameAtGoLive(p: {
  wasLive: boolean;
  inCup: boolean;
  teamCount: number;
  gameTypeId: string | null | undefined;
  /** Everyone the draft has playing (grouped, or paired). */
  playerIds: string[];
  teamOf: (userId: string) => string | undefined;
}): boolean {
  if (p.wasLive) return false;
  if (!pairsFromRosters({ inCup: p.inCup, teamCount: p.teamCount })) return false;
  if (!canBeSideGame(p.gameTypeId)) return false;
  if (p.playerIds.length === 0) return false;
  return p.playerIds.every((id) => !p.teamOf(id));
}

/**
 * The payload key that carries the choice, sent ONLY with the go-live it was
 * chosen at: if the draft no longer turns scoring on (the toggle went back off),
 * the leave is not sent. So it can never travel without its go-live, and the
 * page cannot show "not live" while a save quietly moves the game.
 */
export function leaveCompetitionKey(p: {
  chosen: boolean;
  draftScoring: boolean;
  savedScoring: boolean;
}): { leaveCompetition: true } | Record<string, never> {
  return p.chosen && p.draftScoring && !p.savedScoring ? { leaveCompetition: true } : {};
}
