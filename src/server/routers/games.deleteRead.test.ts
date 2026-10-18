import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1276 (reopened) — `games.delete`'s game read, one of the 16 sites the
 * guard's old pattern hid. A failed read used to answer "Game not found" for a
 * game that exists. It never deleted anything, so this pins the WORDS and the
 * code: a failed read is a retryable 500, the game is still there, and a game
 * that really doesn't exist is still NOT_FOUND.
 */

let ctx: TestContext;
let tripId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("1276 delete read");
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const gameExists = async (gameId: string) =>
  ((await ctx.admin.from("games").select("id", { count: "exact", head: true }).eq("id", gameId)).count ?? 0) > 0;

describe("games.delete's game read (#1276)", () => {
  it("a failed read is a retryable 500, not 'Game not found', and the game is still there", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "1276 keep" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      callerFailingRead(ctx, "owner", { table: "games", columns: "id, competition_id" }).games.delete({ tripId, gameId: g.id as string })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    vi.restoreAllMocks();
    expect(await gameExists(g.id as string)).toBe(true);
  }, 60_000);

  it("CONTROL: a game that really doesn't exist is still NOT_FOUND", async () => {
    await expect(ctx.caller().games.delete({ tripId, gameId: "no-such-game-1276" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Game not found",
    });
  }, 60_000);

  it("CONTROL: through a working read, the delete goes through", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "1276 go" });
    await ctx.caller().games.delete({ tripId, gameId: g.id as string });
    expect(await gameExists(g.id as string)).toBe(false);
  }, 60_000);
});
