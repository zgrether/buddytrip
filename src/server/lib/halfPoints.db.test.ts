import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * The board's `halfPoints` flag, read from a real cup (Zach's half-points rule,
 * and his look on #1694). `cupCountsInHalves` is pinned in `halfPoints.test.ts`;
 * this pins what the board hands it — in particular each paired match's own
 * `point_value`, which the board's match read did not select before this flag.
 */

let ctx: TestContext;
let tripId: string;
let comp: string;
let gameId: string;

async function setMatches(total: number, values: (number | null)[]) {
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("games").update({ points_total: total }).eq("id", gameId);
  for (const [i, v] of values.entries()) {
    const { error } = await ctx.admin.from("game_matches").insert({
      id: genId("gm"),
      game_id: gameId,
      match_number: i + 1,
      display_order: i,
      side_a: { type: "user", id: ctx.user.id },
      side_b: { type: "user", id: ctx.getUser("member").id },
      point_value: v,
      status: "pending",
    });
    if (error) throw new Error(`seed match: ${error.message}`);
  }
}

const halfPoints = async () => (await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp })).halfPoints;

beforeAll(async () => {
  ctx = await TestContext.create();
  ({ tripId, competitionId: comp } = await ctx.createCupTrip({ title: "Half Points Trip", name: "Half Cup" }));
  await ctx.createTeam(comp, "A", { shortName: "A" });
  await ctx.createTeam(comp, "B", { shortName: "B" });
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "Day 1", competitionId: comp })) as { id: string };
  gameId = g.id;
});

afterAll(async () => {
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

describe("the board's halfPoints flag", () => {
  it("two matches sharing 2 points: 1 a match, so yes", async () => {
    await setMatches(2, [null, null]);
    expect(await halfPoints()).toBe(true);
  });

  it("CONTROL, two matches sharing 4 points: 2 a match, so no", async () => {
    await setMatches(4, [null, null]);
    expect(await halfPoints()).toBe(false);
  });

  it("a match's own value is read: 2 points with one match set to 2 leaves the other at 0, so no", async () => {
    // Without `point_value` in the board's read, both matches would share the 2
    // evenly — 1 each — and this would say yes.
    await setMatches(2, [2, null]);
    expect(await halfPoints()).toBe(false);
  });

  it("a mixed cup: a Simple game beside the 1-point match game makes it no, and removing it makes it yes again", async () => {
    await setMatches(2, [null, null]);
    expect(await halfPoints()).toBe(true);
    const simple = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_generic_card", name: "Euchre", competitionId: comp })) as { id: string };
    await ctx.admin.from("games").update({ competition_format: "head_to_head", points_total: 2 }).eq("id", simple.id);
    try {
      expect(await halfPoints()).toBe(false);
    } finally {
      await ctx.admin.from("games").delete().eq("id", simple.id);
    }
    expect(await halfPoints()).toBe(true);
  });

  it("an unpaired match game is ignored: a second match game with no pairings leaves it yes", async () => {
    await setMatches(2, [null, null]);
    const unpaired = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "Day 2", competitionId: comp })) as { id: string };
    await ctx.admin.from("games").update({ points_total: 8 }).eq("id", unpaired.id);
    try {
      expect(await halfPoints()).toBe(true);
    } finally {
      await ctx.admin.from("games").delete().eq("id", unpaired.id);
    }
  });
});
