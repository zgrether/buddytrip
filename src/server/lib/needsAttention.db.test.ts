import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * The leaderboard carries the Needs attention card's items, read from real
 * rows: who is playing in a cup game on no team (and only them), and uneven
 * teams where a stroke game sums its players. Each case builds its own cup.
 */

let ctx: TestContext;
let owner: string, member: string, planner: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  planner = ctx.getUser("planner").id;
}, 60_000);
afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function tournament(label: string) {
  return ctx.createCupTrip({
    name: `attention ${label}`,
    scoringModel: "points",
    teams: ["Alpha", "Bravo"],
    members: [["member", "Member"], ["planner", "Organizer"]],
  });
}
const attention = async (tripId: string, competitionId: string) =>
  ((await ctx.caller().competitions.leaderboard({ tripId, competitionId })) as { needsAttention: unknown }).needsAttention;

describe("the leaderboard's Needs attention", () => {
  it("someone PLAYING on no team is listed with the game; someone on the trip who plays nothing is not", async () => {
    const { tripId, competitionId, teamIds } = await tournament("off team");
    await ctx.assignTeam(competitionId, teamIds[0], [owner]);
    await ctx.assignTeam(competitionId, teamIds[1], [member]);
    const g = (await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_stroke_play", name: "Day 2 Stroke", pointsTotal: 10 })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [owner, member, planner] });
    const a = (await attention(tripId, competitionId)) as { offTeam: { names: string[]; games: string[] } | null; uneven: unknown };
    expect(a.offTeam?.games).toEqual(["Day 2 Stroke"]);
    expect(a.offTeam?.names).toHaveLength(1);
    expect(a.uneven).toBeNull();
  });

  it("uneven teams, with a stroke game: sizes in team order and the scoring that makes it count", async () => {
    const { tripId, competitionId, teamIds } = await tournament("uneven");
    await ctx.assignTeam(competitionId, teamIds[0], [owner, planner]);
    await ctx.assignTeam(competitionId, teamIds[1], [member]);
    await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_stroke_play", name: "Stroke", pointsTotal: 10 });
    const a = (await attention(tripId, competitionId)) as {
      offTeam: unknown;
      emptyTeams: unknown[];
      uneven: { teams: { name: string; size: number }[]; scorings: string[] } | null;
    };
    expect(a.offTeam).toBeNull();
    expect(a.emptyTeams).toEqual([]);
    expect(a.uneven?.teams.map((t) => [t.name, t.size])).toEqual([["Alpha", 2], ["Bravo", 1]]);
    expect(a.uneven?.scorings).toEqual(["traditional"]);
  });

  it("CONTROL: even teams and nobody off a team: nothing", async () => {
    const { tripId, competitionId, teamIds } = await tournament("clear");
    await ctx.assignTeam(competitionId, teamIds[0], [owner]);
    await ctx.assignTeam(competitionId, teamIds[1], [member]);
    await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_stroke_play", name: "Stroke", pointsTotal: 10 });
    expect(await attention(tripId, competitionId)).toEqual({ offTeam: null, emptyTeams: [], uneven: null });
  });
});
