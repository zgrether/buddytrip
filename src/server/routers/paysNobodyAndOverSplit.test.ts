import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { getGameTypeDefinition } from "@/lib/gameTypes";

/**
 * #1427 — can points be shown that no team can win?
 *
 * Two ways a game could leave part of its total in points-available with nobody
 * able to earn it, measured:
 *
 * 1. RACK PAYING NOBODY — reachable: a rostered player who never scores leaves
 *    an undecided slot at finalize (#1368), and a finished per-match rack game
 *    pays less than its total. The board stays HONEST: a finished game whose arm
 *    `expects: "points"` counts what it paid (`settledPool`, #1420/#1425). That
 *    held for the other per-match formats; nothing pinned it for rack.
 *
 * 2. A PLACEMENT SPLIT LONGER THAN THE TEAMS — every split WRITE refuses it, but
 *    deleting a team lowered the count underneath splits already saved, and
 *    `games.create` accepted any split. Both now refuse, with a control each
 *    proving the refusal is about the length and not the act.
 */

let ctx: TestContext;
const CREW: NonNullable<NonNullable<Parameters<TestContext["createCupTrip"]>[0]>["members"]> = [
  ["planner", "Organizer"],
  ["member", "Member"],
  ["outsider", "Member"],
];

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

type Schema = { units?: { metadata?: { par?: number[] } } } | null;
const PAR = (getGameTypeDefinition("gtt_rack_n_stack")?.scorecardSchema as Schema)?.units?.metadata?.par ?? [];

/** A finished 2 v 2 per-match rack worth 2, scored by `scorers` (others never post). */
async function finishedRack(name: string, scorers: "all" | "one-no-show") {
  const { tripId, competitionId } = await ctx.createCupTrip({ name, scoringModel: "match_play", members: CREW });
  const owner = ctx.user.id;
  const planner = ctx.getUser("planner").id;
  const member = ctx.getUser("member").id;
  const outsider = ctx.getUser("outsider").id;
  const a = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const b = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: a },
    { competition_id: competitionId, user_id: planner, team_id: a },
    { competition_id: competitionId, user_id: member, team_id: b },
    { competition_id: competitionId, user_id: outsider, team_id: b },
  ]);
  expect(ins.error).toBeNull();
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_rack_n_stack", name: "Rack", competitionId,
    pointsDistribution: { type: "per_match", value: 1 },
  })) as { id: string };
  await ctx.admin.from("games").update({ points_total: 2 }).eq("id", game.id);
  await ctx.caller().playGroups.setFoursomes({
    tripId, gameId: game.id,
    groups: [{ name: "G1", userIds: [owner, member] }, { name: "G2", userIds: [planner, outsider] }],
  });
  await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  const players: [string, number][] = [[owner, 0], [member, 1], [outsider, 1]];
  if (scorers === "all") players.push([planner, 0]);
  for (const [userId, over] of players) {
    for (let i = 0; i < PAR.length; i++) {
      await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: userId, unitLabel: String(i + 1), value: PAR[i] + over });
    }
  }
  await ctx.caller().games.finish({ tripId, gameId: game.id });
  const { data: rows } = await ctx.admin.from("game_results").select("raw_score").eq("game_id", game.id).eq("entity_type", "team");
  const paid = (rows ?? []).reduce((s, r) => s + Number(r.raw_score ?? 0), 0);
  const board = (await ctx.caller().competitions.leaderboard({ tripId, competitionId })) as { pointsAvailable: number };
  return { paid, pointsAvailable: board.pointsAvailable };
}

describe("rack paying nobody leaves no unwinnable points on the board (#1427 · 1)", () => {
  it("a no-show's undecided slot pays nobody, and points-available drops to what was paid", async () => {
    expect(PAR.length, "precondition: a scorecard to play").toBeGreaterThan(0);
    const r = await finishedRack("1427 · rack no-show", "one-no-show");
    expect(r.paid, "precondition: it really did pay less than its total of 2").toBe(1);
    expect(r.pointsAvailable).toBe(1);
  }, 120_000);

  it("CONTROL: everyone plays, it pays its full 2, and points-available is 2", async () => {
    const r = await finishedRack("1427 · rack full", "all");
    expect(r.paid).toBe(2);
    expect(r.pointsAvailable).toBe(2);
  }, 120_000);
});

/** A three-team points tournament with one stroke game split `values`. */
async function threeTeamRace(name: string, values: number[]) {
  const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
    name, scoringModel: "points", members: CREW, teams: ["Red", "Green", "Blue"],
  });
  const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Day 2 Stroke", competitionId })) as { id: string };
  const total = values.reduce((s, v) => s + v, 0);
  await ctx.admin.from("games").update({ points_total: total }).eq("id", game.id);
  await ctx.caller().games.setPointsDistribution({ tripId, gameId: game.id, distribution: { type: "placement", values } });
  return { tripId, competitionId, teamIds };
}

async function teamsIn(competitionId: string) {
  const { count } = await ctx.admin.from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId);
  return count;
}

describe("a placement split can no longer outrun the teams (#1427 · 2)", () => {
  it("deleting a team that would leave a 3-place split with 2 teams is refused, naming the game", async () => {
    const { tripId, competitionId, teamIds } = await threeTeamRace("1427 · delete refused", [5, 3, 2]);
    await expect(ctx.caller().teams.delete({ tripId, teamId: teamIds[2] })).rejects.toThrow(
      "Day 2 Stroke awards points to more places than 2 teams can finish in. Shorten its points split first, or keep this team."
    );
    expect(await teamsIn(competitionId)).toBe(3);
  }, 60_000);

  it("CONTROL: with a 2-place split the same delete goes through", async () => {
    const { tripId, competitionId, teamIds } = await threeTeamRace("1427 · delete allowed", [6, 4]);
    await ctx.caller().teams.delete({ tripId, teamId: teamIds[2] });
    expect(await teamsIn(competitionId)).toBe(2);
  }, 60_000);

  it("creating a game with more places than the tournament has teams is refused", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "1427 · create", scoringModel: "points", members: CREW, teams: ["Red", "Green"],
    });
    await expect(
      ctx.caller().games.create({
        tripId, gameTypeId: "gtt_stroke_play", name: "Too long", competitionId,
        pointsTotal: 10, pointsDistribution: { type: "placement", values: [5, 3, 2] },
      })
    ).rejects.toThrow("3 places configured, 2 teams in this tournament");
    const { count } = await ctx.admin.from("games").select("id", { count: "exact", head: true }).eq("competition_id", competitionId);
    expect(count).toBe(0);

    // CONTROL: two places fit two teams.
    await expect(
      ctx.caller().games.create({
        tripId, gameTypeId: "gtt_stroke_play", name: "Fits", competitionId,
        pointsTotal: 10, pointsDistribution: { type: "placement", values: [6, 4] },
      })
    ).resolves.toBeTruthy();
  }, 60_000);
});
