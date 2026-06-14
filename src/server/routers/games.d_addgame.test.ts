import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Slice D add-game flow — Stage 3: sum-to-total server enforcement + the
 * delegation boundary (owner sets the total; a game-delegate distributes within
 * it but can't change it). The enforcement reuses the pure validatePlacement
 * (gameConfig.ts), so the API rejects exactly what the UI blocks.
 */

const MANUAL = "gtt_manual";

let ctx: TestContext;
let tripId: string;
let memberId: string;
const gameIds: string[] = [];

async function newGame(pointsTotal: number | null, name = "Placement Game") {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name,
    pointsTotal,
  })) as { id: string; points_total: number | null };
  gameIds.push(g.id);
  return g;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("D Add-Game Trip");
  await ctx.addTripMember(tripId, "member", "Member"); // delegate target (plain Member)
  memberId = ctx.getUser("member").id;
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_organizers").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

describe("Stage 3 — owner sets the total on the Game tab", () => {
  it("create persists points_total", async () => {
    const g = await newGame(8);
    expect(g.points_total).toBe(8);
  });

  it("owner can change the total via setPointsTotal", async () => {
    const g = await newGame(8);
    await ctx.caller().games.setPointsTotal({ tripId, gameId: g.id, total: 10 });
    const after = (await ctx.caller().games.getById({ tripId, gameId: g.id })) as { points_total: number | null };
    expect(after.points_total).toBe(10);
  });
});

describe("Stage 3 — sum-to-total enforcement (nil-vs-entered)", () => {
  it("UNTOUCHED (empty values) distribution SAVES — the shell state", async () => {
    const g = await newGame(8);
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [] },
      })
    ).resolves.toBeTruthy();
  });

  it("COMPLETE distribution (sum === total) SAVES", async () => {
    const g = await newGame(8);
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [5, 3] },
      })
    ).resolves.toBeTruthy();
  });

  it("0-value lower place is fine when the sum matches", async () => {
    const g = await newGame(8);
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [5, 3, 0] },
      })
    ).resolves.toBeTruthy();
  });

  it("PARTIAL distribution (entered, sum < total) is REJECTED", async () => {
    const g = await newGame(8);
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [5] },
      })
    ).rejects.toThrow(/must total 8/i);
  });

  it("OVER-allocation (sum > total) is REJECTED", async () => {
    const g = await newGame(8);
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [5, 5] },
      })
    ).rejects.toThrow(/must total 8/i);
  });

  it("a legacy game with no total keeps free-form behavior (no enforcement)", async () => {
    const g = await newGame(null);
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [9, 6, 4, 2] },
      })
    ).resolves.toBeTruthy();
  });

  it("per_match distribution is not subject to sum-to-total", async () => {
    const g = await newGame(null, "Match Game");
    await expect(
      ctx.caller().games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "per_match", value: 1 },
      })
    ).resolves.toBeTruthy();
  });
});

describe("Stage 3 — the delegation boundary", () => {
  it("a delegate can distribute to the total but CANNOT change the total", async () => {
    const g = await newGame(8, "Delegated Game");
    await ctx.caller().games.addOrganizer({ tripId, gameId: g.id, userId: memberId });
    const member = ctx.callerAs("member");

    // Distribute within the total — allowed.
    await expect(
      member.games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [5, 3] },
      })
    ).resolves.toBeTruthy();

    // Partial — blocked for the delegate too (server-side, not just UI).
    await expect(
      member.games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [5] },
      })
    ).rejects.toThrow(/must total 8/i);

    // Changing the total — forbidden (Member-level, no Organizer role).
    await expect(
      member.games.setPointsTotal({ tripId, gameId: g.id, total: 12 })
    ).rejects.toThrow();
  });

  it("a delegate exceeding the total is rejected", async () => {
    const g = await newGame(8, "Delegated Game 2");
    await ctx.caller().games.addOrganizer({ tripId, gameId: g.id, userId: memberId });
    const member = ctx.callerAs("member");
    await expect(
      member.games.setPointsDistribution({
        tripId, gameId: g.id, distribution: { type: "placement", values: [9, 9] },
      })
    ).rejects.toThrow(/must total 8/i);
  });
});

describe("delete — hard removal, Organizer-gated (L3-b)", () => {
  it("owner deletes a game and it's gone; a plain Member cannot", async () => {
    const g = await newGame(8, "To delete");
    // Organizer-gated: a plain Member (even a would-be delegate) cannot delete.
    await expect(ctx.callerAs("member").games.delete({ tripId, gameId: g.id })).rejects.toThrow();
    // Owner hard-deletes → the game is gone.
    await expect(ctx.caller().games.delete({ tripId, gameId: g.id })).resolves.toBeTruthy();
    await expect(ctx.caller().games.getById({ tripId, gameId: g.id })).rejects.toThrow(/not found/i);
  });
});
