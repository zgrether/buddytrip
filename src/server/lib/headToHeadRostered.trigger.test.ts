import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 193 — a Ryder cup's game participants are rostered (ruling 3).
 *
 * The trigger refuses a `game_participants` INSERT for a game in a
 * `match_play` competition when the person has no `team_assignments` row in
 * that competition. Each case below is one the guard needs and a wrong build
 * would get wrong:
 *
 *  - the refusal itself, with the person's NAME in it (a build raising a bare
 *    error, or the wrong prefix, fails on the exact text);
 *  - a rostered player, a points cup and a standalone game all pass (a build
 *    that refuses too much fails these);
 *  - an UPDATE is never refused, because the guest→account merge repoints
 *    `user_id` with one inside the signup trigger (a build covering UPDATE
 *    fails that case — and would fail signups in production);
 *  - the refusal reaches a real caller through tRPC (`playGroups.setFoursomes`),
 *    not only a raw insert.
 */

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string;
let memberName: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("H2H Rostered Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  const { data } = await ctx.admin.from("users").select("name").eq("id", member).single();
  memberName = (data as { name: string }).name;
});

afterAll(async () => {
  await ctx.cleanup();
});

/** A Ryder cup with owner on Blue and planner on Red; `member` is on NEITHER. */
async function ryderCup(name: string): Promise<string> {
  const comp = await ctx.createCompetition(tripId, name, { scoringModel: "match_play" });
  const blue = await ctx.createTeam(comp, "Blue", { shortName: "BLU", color: "#3b82f6" });
  const red = await ctx.createTeam(comp, "Red", { shortName: "RED", color: "#ef4444" });
  await ctx.admin.from("team_assignments").insert([
    { competition_id: comp, user_id: owner, team_id: blue },
    { competition_id: comp, user_id: planner, team_id: red },
  ]);
  return comp;
}

async function game(competitionId: string | null, gameTypeId = "gtt_rack_n_stack"): Promise<string> {
  const g = await ctx.caller().games.create({
    tripId,
    gameTypeId,
    name: `g-${genId()}`,
    ...(competitionId ? { competitionId } : {}),
  });
  return g.id as string;
}

function participant(gameId: string, userId: string) {
  return ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: gameId, user_id: userId });
}

describe("migration 193 — Ryder cup participants are rostered", () => {
  it("refuses an unrostered player in a Ryder cup game, naming them and the fix", async () => {
    const gameId = await game(await ryderCup("Refuses"));
    const { error } = await participant(gameId, member);
    expect(error?.message).toBe(
      `UNROSTERED: ${memberName} isn't on either team in this cup. Add them to a team in Rosters first.`,
    );
    const { count } = await ctx.admin
      .from("game_participants")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("user_id", member);
    expect(count).toBe(0);
  }, 60000);

  it("admits a rostered player", async () => {
    const gameId = await game(await ryderCup("Admits"));
    const { error } = await participant(gameId, owner);
    expect(error).toBeNull();
  }, 60000);

  it("leaves a points cup alone — ruling 3 is head-to-head only", async () => {
    const comp = await ctx.createCompetition(tripId, "Points", { scoringModel: "points" });
    const gameId = await game(comp, "gtt_stroke_play");
    const { error } = await participant(gameId, member);
    expect(error).toBeNull();
  }, 60000);

  it("leaves a standalone game alone", async () => {
    const gameId = await game(null, "gtt_stroke_play");
    const { error } = await participant(gameId, member);
    expect(error).toBeNull();
  }, 60000);

  it("never refuses an UPDATE — the guest merge repoints user_id inside the signup trigger", async () => {
    const gameId = await game(await ryderCup("Update"));
    const id = genId("gp");
    expect((await ctx.admin.from("game_participants").insert({ id, game_id: gameId, user_id: owner })).error).toBeNull();
    // Repoint the row at the unrostered player, the way the merge repoints a
    // guest at the real account. Insert-only means this must pass.
    const { error } = await ctx.admin.from("game_participants").update({ user_id: member }).eq("id", id);
    expect(error).toBeNull();
    const { data } = await ctx.admin.from("game_participants").select("user_id").eq("id", id).single();
    expect((data as { user_id: string }).user_id).toBe(member);
  }, 60000);

  it("reaches a real caller: grouping an unrostered player into a Ryder cup rack is refused", async () => {
    const gameId = await game(await ryderCup("Real caller"));
    await expect(
      ctx.caller().playGroups.setFoursomes({
        tripId,
        gameId,
        groups: [{ name: "G1", userIds: [owner, planner, member] }],
      }),
    ).rejects.toThrow(`UNROSTERED: ${memberName} isn't on either team in this cup.`);
  }, 60000);
});
