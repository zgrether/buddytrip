import { describe, it, expect } from "vitest";
import { invalidateGameBoards, type GameBoardUtils } from "./gameBoardInvalidation";

/**
 * The one invalidator for a game change the Games page shows (PR 6b). The bug
 * it replaces: every call site refreshed the board only `if (competitionId)`,
 * so a side game's go-live saved and the page never heard. These pin the exact
 * set, per container.
 */
function recorder() {
  const calls: string[] = [];
  const rec = (key: string) => ({ invalidate: (input: unknown) => void calls.push(`${key} ${JSON.stringify(input)}`) });
  const utils: GameBoardUtils = {
    competitions: { leaderboard: rec("leaderboard"), faceBootstrap: rec("faceBootstrap") },
    games: { listByTrip: rec("listByTrip"), sideBoard: rec("sideBoard") },
  };
  return { utils, calls };
}

describe("invalidateGameBoards", () => {
  it("a SIDE game refreshes everything the Games page reads — never nothing", () => {
    const { utils, calls } = recorder();
    invalidateGameBoards(utils, { tripId: "t1", competitionId: null });
    expect(calls).toEqual([
      `faceBootstrap {"tripId":"t1"}`,
      `listByTrip {"tripId":"t1"}`,
      `sideBoard {"tripId":"t1"}`,
    ]);
  });

  it("a CUP game refreshes the cup's standings too, and the side board with it", () => {
    const { utils, calls } = recorder();
    invalidateGameBoards(utils, { tripId: "t1", competitionId: "c1" });
    expect(calls).toEqual([
      `leaderboard {"tripId":"t1","competitionId":"c1"}`,
      `faceBootstrap {"tripId":"t1"}`,
      `listByTrip {"tripId":"t1"}`,
      `sideBoard {"tripId":"t1"}`,
    ]);
  });
});
