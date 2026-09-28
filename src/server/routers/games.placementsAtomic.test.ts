import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1398 — a placement finalize replaces a game's results ATOMICALLY.
 *
 * The placement arms of `games.finish` (the entered order and the bracket's
 * derived one) used to commit as a bare DELETE and a bare INSERT: two PostgREST
 * requests with nothing spanning them. An insert that failed after the delete
 * had committed left a finished game with NO results, while the board still
 * counted its points as available. A correction is where that bites, because a
 * correction is a re-finalize of a game that already has results to lose.
 *
 * The failure is made deterministic rather than simulated: migration 194 allows
 * one row per unit per game, and `placements` does not refuse a repeated entity,
 * so posting the same team twice passes validation and fails AT THE INSERT —
 * the exact window, reached through the real caller. A transient PostgREST
 * failure there does the same thing; this is just one that happens every time.
 *
 * What would leave this green that shouldn't: a refusal EARLIER than the write
 * (validation, the guard), which would also preserve the rows. So the case
 * asserts the error is the write's own ("Failed to save results"), and the
 * control proves the fixture's first finalize really wrote rows.
 */

const MANUAL = "gtt_generic_card";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function resultsOf(gameId: string) {
  const { data, error } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, position, value_kind")
    .eq("game_id", gameId)
    .order("position");
  if (error) throw new Error(`read results: ${error.message}`);
  return data ?? [];
}

describe("games.finish — a failed placement write leaves the previous results", () => {
  it("a correction whose write fails keeps the finalized order instead of erasing it", async () => {
    const { tripId, competitionId: comp } = await ctx.createCupTrip({
      title: "placements-atomic trip", name: "Placements Atomic Cup", scoringModel: "points",
    });
    const blue = await ctx.createTeam(comp, "Blue", { shortName: "BLU" });
    const red = await ctx.createTeam(comp, "Red", { shortName: "RED" });
    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "Atomic placement",
      competitionId: comp,
      pointsDistribution: { type: "placement", values: [5, 3] },
      pointsTotal: 8,
    })) as { id: string };

    // CONTROL: the first finalize writes the order. Without this, "the rows are
    // still there" below could be true of a game that never had any.
    await ctx.caller().games.finish({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: blue, position: 1 },
        { entityId: red, position: 2 },
      ],
    });
    const before = await resultsOf(g.id);
    expect(before).toEqual([
      { entity_id: blue, entity_type: "team", position: 1, value_kind: "rank" },
      { entity_id: red, entity_type: "team", position: 2, value_kind: "rank" },
    ]);

    // The correction: reopen, then re-finalize with a write that fails at the
    // insert (the same team twice violates one-row-per-unit).
    await ctx.caller().games.openCorrection({ tripId, gameId: g.id });
    await expect(
      ctx.caller().games.finish({
        tripId,
        gameId: g.id,
        placements: [
          { entityId: red, position: 1 },
          { entityId: red, position: 2 },
        ],
      })
    ).rejects.toThrow(/Failed to save results/);

    // THE MECHANISM: the delete did not survive the failed insert. Before the
    // fix this read [] — the finalized order erased by a correction that failed.
    expect(await resultsOf(g.id)).toEqual(before);

    // And the board still pays the order it had.
    const board = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(board.teamTotals[blue]).toBe(5);
    expect(board.teamTotals[red]).toBe(3);
  }, 60000);
});
