import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1611 — the placement-capacity guard FAILS CLOSED.
 *
 * `setPointsDistribution` (and `saveConfig`) refuse a placement split with more
 * places than the game has teams or entrants to award them to. The capacity
 * comes from three reads, and each used to answer a failure by skipping the
 * check: a failed game read looked "standalone", a failed team count looked
 * "unknown", a failed entrant count looked "unknown capacity", which its own
 * comment called "the safe direction". For a safeguard, skipping is the guard
 * failing open (#1469), and Zach's rule is fail closed. Each read now refuses
 * the save with the retryable read-failure sentence.
 *
 * Each failing client fails exactly ONE read (table + exact columns); the exact
 * sentence names which read, so a refusal from any other door can't pass for it.
 * The control is the same save through a client that fails nothing.
 */

const SENTENCE = (what: string) => `Couldn't check the ${what} just now. This is temporary — try again in a moment.`;

let ctx: TestContext;
let tripId: string;
let gameId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  const cup = await ctx.createCupTrip({ name: "Capacity fails closed", scoringModel: "points", members: ["member"], teams: ["Blue", "Red"] });
  tripId = cup.tripId;
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_generic_yard", name: "Cornhole", competitionId: cup.competitionId,
  })) as { id: string };
  gameId = game.id;
  await ctx.caller().games.setPointsTotal({ tripId, gameId, total: 10 });
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

// Two places for a two-team cup: a split the guard ADMITS when it can check.
const save = (caller: ReturnType<TestContext["caller"]>) =>
  caller.games.setPointsDistribution({ tripId, gameId, distribution: { type: "placement", values: [6, 4] } });

describe("placement capacity: a failed read refuses the save, it doesn't skip the check", () => {
  it("control: with nothing failing, the split saves", async () => {
    await expect(save(ctx.caller())).resolves.toBeDefined();
  });

  it("control: the guard is live — three places for two teams is refused", async () => {
    await expect(
      ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "placement", values: [5, 3, 2] } })
    ).rejects.toThrow("3 places, but only 2 teams can finish.");
  });

  it("the entrant count fails → refused (it used to be 'unknown capacity', never refusing)", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "bracket_entrants", columns: "id" });
    await expect(save(failing)).rejects.toThrow(SENTENCE("bracket's entrant count"));
  });

  it("the game read fails → refused (it used to look 'standalone' and skip)", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "games", columns: "competition_id" });
    await expect(save(failing)).rejects.toThrow(SENTENCE("game"));
  });

  it("the team count fails → refused (it used to be 'unknown' and skip)", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "teams", columns: "id" });
    await expect(save(failing)).rejects.toThrow(SENTENCE("team count"));
  });
});
