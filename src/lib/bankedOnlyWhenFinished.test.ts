import { describe, it, expect } from "vitest";
import { bankedOnlyWhenFinished, rollUp, type LiveGame } from "./competitionPlacement";

/**
 * #1416, the pure half: a game banks its rows only once it is FINISHED.
 * The DB half — real writers, the double count, the silent clinch — is
 * `src/server/lib/liveGameBanksNothing.test.ts`.
 */

// A match-play game with one decided match banked for Blue: the shape a
// mid-round setup edit leaves behind.
const withRows: LiveGame = {
  id: "g",
  distribution: [3, 0],
  numTeams: 2,
  standings: [
    { entityId: "blue", value: 3 },
    { entityId: "red", value: 0 },
  ],
  direction: "high_wins",
  pointsTotal: 3,
};
const teams = ["blue", "red"];

describe("bankedOnlyWhenFinished", () => {
  it("a LIVE game banks nothing — whatever rows reached it", () => {
    for (const status of ["active", "pending", null]) {
      const g = bankedOnlyWhenFinished(withRows, status);
      expect(g.standings, String(status)).toEqual([]);
      expect(rollUp([g], teams).teamTotals.get("blue"), String(status)).toBe(0);
    }
  });

  it("a FINISHED game banks what it paid — the control", () => {
    const g = bankedOnlyWhenFinished(withRows, "complete");
    expect(rollUp([g], teams).teamTotals.get("blue")).toBe(3);
  });

  it("keyed on STATUS: a game re-opened for a correction keeps its banked result", () => {
    /**
     * `corrections_open` leaves `status = complete`, so the function is never
     * asked about it — which is the point. A lock-state reading would un-bank
     * the game when the correction opened: un-clinch, release the claim, and
     * re-announce at the re-finalize. `CompletedRow`'s IN REVIEW badge relies
     * on the totals staying put for the same reason.
     *
     * This case is the CONTROL for that, not the guard: the function takes only
     * `status`, so a lock-state mistake would be made at the CALL SITE (passing
     * something other than `status`), where no pure test can see it. What
     * catches that is DB-level — `pointsAvailablePaid.test.ts` opens a
     * correction and asserts the team is STILL clinched, which un-banking would
     * break.
     */
    const g = bankedOnlyWhenFinished(withRows, "complete");
    expect(g.standings).toHaveLength(2);
  });

  it("withholds only the standings — the target and the schedule are someone else's", () => {
    // The target is `settledPool`'s: a live game keeps its owner-set total. And
    // a positions game's schedule must survive, because a null-total placement
    // game falls back to it for points-available.
    const g = bankedOnlyWhenFinished({ ...withRows, pointsTotal: null, distribution: [5, 3] }, "active");
    expect(g.pointsTotal).toBeNull();
    expect(g.distribution).toEqual([5, 3]);
    expect(rollUp([g], teams).pointsAvailable).toBe(8);
  });
});
