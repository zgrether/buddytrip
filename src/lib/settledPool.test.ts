import { describe, it, expect } from "vitest";
import { settledPool, gamePayout, rollUp, type LiveGame } from "./competitionPlacement";

/**
 * #1420 — a FINISHED per-match game counts what it paid toward points-available,
 * not what was set. Rulings (Zach, 2026-09-23):
 *  1. complete → what it paid;
 *  2. live → the owner-set total, because a live game's unpaid share moves on
 *     paths that never call `games.finish`, the only place a clinch is announced;
 *  3. an open correction HOLDS the paid figure — keyed on `status`, not the lock.
 *
 * Each ruling has a case below that fails the build that gets it wrong.
 */

/**
 * A per-match game as the leaderboard hands it over after reconciliation: the
 * rows' points ARE the award, passed through as the synthetic distribution,
 * ranked `high_wins` (`reconcileConvention`'s points reading).
 */
const pointsGame = (id: string, paid: Record<string, number>, ownerTotal: number): LiveGame => {
  const standings = Object.entries(paid)
    .map(([entityId, value]) => ({ entityId, value }))
    .sort((a, b) => b.value - a.value);
  return {
    id,
    distribution: standings.length ? standings.map((s) => s.value) : null,
    numTeams: 2,
    standings,
    direction: "high_wins",
    pointsTotal: ownerTotal,
  };
};

const COMPLETE = { expectsPoints: true, status: "complete", correctionsOpen: false } as const;

describe("settledPool — what a game contributes to points-available", () => {
  // Blue won 4, Red won 2: 2 of the 8 went to nobody (a side on no team, an
  // undecided match, two empty pick'em sheets — the cause is the format's own
  // business; this reads what was written).
  const underPaid = pointsGame("g", { blue: 4, red: 2 }, 8);

  it("a FINISHED per-match game counts what it paid — 6, not the 8 that was set", () => {
    expect(settledPool(underPaid, COMPLETE)).toBe(6);
  });

  it("a LIVE game keeps the owner-set total — its unpaid share is not an event finish will see", () => {
    // Ruling 2. The mutant that drops the `status` check fails here.
    for (const status of ["pending", "active", null]) {
      expect(settledPool(underPaid, { ...COMPLETE, status }), String(status)).toBe(8);
    }
  });

  it("an OPEN CORRECTION holds the paid figure — opening one must not raise the target", () => {
    /**
     * Ruling 3. Opening a correction sets `corrections_open` and leaves
     * `status = complete`. Keyed on the LOCK state instead, the target would jump
     * back to 8 the moment a correction opened: un-clinch, release the claim,
     * then re-clinch at the re-finalize and push "X clinched" to every phone —
     * on every correction cycle of an under-paid game.
     */
    expect(settledPool(underPaid, { ...COMPLETE, correctionsOpen: true })).toBe(6);
  });

  it("a POSITIONS game (placement, bracket, points-cup pick'em) is untouched even when finished", () => {
    // Out of scope: no match in it can pay nobody. The mutant that drops the
    // `expectsPoints` check fails here.
    const placement: LiveGame = {
      id: "p",
      distribution: [5, 3],
      numTeams: 2,
      standings: [
        { entityId: "blue", value: 1 },
        { entityId: "red", value: 2 },
      ],
      direction: "low_wins",
      pointsTotal: 10,
    };
    expect(settledPool(placement, { ...COMPLETE, expectsPoints: false })).toBe(10);
  });

  it("a finished game that paid NOTHING counts 0 — not the total, and not 'unknown'", () => {
    /**
     * A pick'em finalized with no matches drawn pays nobody: the WHOLE total is
     * unpaid. That is a decided zero, and it must reach `rollUp` as 0 — which
     * `??` keeps — rather than as a missing value that falls back to anything.
     */
    const nothing = pointsGame("n", {}, 8);
    expect(settledPool(nothing, COMPLETE)).toBe(0);
    expect(rollUp([{ ...nothing, pointsTotal: settledPool(nothing, COMPLETE) }], ["blue", "red"]).pointsAvailable).toBe(0);
  });

  it("counts exactly what the teams BANKED — one payout, two readers", () => {
    // `rollUp` banks `gamePayout`; `settledPool` sums it. If either stopped
    // reading the same function, points-available minus the banked totals would
    // stop meaning "what is still to play".
    const g = pointsGame("g", { blue: 4.5, red: 1.5 }, 8);
    const banked = [...gamePayout(g).values()].reduce((a, b) => a + b, 0);
    const roll = rollUp([{ ...g, pointsTotal: settledPool(g, COMPLETE) }], ["blue", "red"]);
    const bankedByRoll = [...roll.teamTotals.values()].reduce((a, b) => a + b, 0);
    expect(settledPool(g, COMPLETE)).toBe(banked);
    expect(roll.pointsAvailable).toBe(bankedByRoll);
  });
});

describe("the clinch the fix creates — and where it can be created", () => {
  /**
   * Finished game worth 10, paid Blue 6 and nobody the other 4; one live game
   * worth 2 still to play.
   *
   *  - counted as SET:  available 12 → first to 6.5 → Blue (6) is 0.5 short,
   *    and 4 of the points it is chasing can never be won by anybody.
   *  - counted as PAID: available  8 → first to 4.5 → Blue has it.
   *
   * The CONTROL is the first line: without it, "clinched" would pass on a
   * scenario that clinches either way and exercise nothing.
   */
  const finished = pointsGame("done", { blue: 6, red: 0 }, 10);
  const live = pointsGame("live", {}, 2);
  const teams = ["blue", "red"];

  it("counted as set: NOT clinched — the control", () => {
    const roll = rollUp([finished, live], teams);
    expect(roll.pointsAvailable).toBe(12);
    expect(roll.pointsToClinch.get("blue")).toBeGreaterThan(0);
  });

  it("counted as paid: clinched — and only because the finished game shrank", () => {
    const settle = (g: LiveGame, status: string) => ({
      ...g,
      pointsTotal: settledPool(g, { ...COMPLETE, status }),
    });
    const roll = rollUp([settle(finished, "complete"), settle(live, "active")], teams);
    expect(roll.pointsAvailable).toBe(8);
    expect(roll.winNumber).toBe(4.5);
    expect(roll.pointsToClinch.get("blue")).toBeLessThanOrEqual(0);
  });
});
