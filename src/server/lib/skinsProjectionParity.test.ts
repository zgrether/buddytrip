import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * PR 9c-1 — SKINS PROJECTS, and the projection is what the board then banks.
 *
 * Ruling 3: skins won so far are final, so the order so far is a real standing
 * and the board can say what it would pay if the round ended now. The arm runs
 * the finalize's own chain and the board's own payout (CLAUDE.md #8), so the
 * test is PARITY rather than a hand-computed number: the projection read just
 * before `games.finish` must equal the points the board banks just after it,
 * with the same holes recorded. A drift between the two — a different rank
 * rule, a different schedule, a team roll-up the finalize does not do — fails
 * here, whichever side moved.
 *
 * Every hole goes through the real `skinsOutcomes.upsertHole`, so the game's
 * lifecycle (and whether the board even admits it as live) is the app's, not a
 * fixture's.
 */

const SKINS = "gtt_skins";

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

type Hole = [groupingId: string, hole: number, winner: string | null];

async function play(tripId: string, gameId: string, holes: Hole[]) {
  for (const [groupingId, holeNumber, winnerId] of holes) {
    await ctx.caller().skinsOutcomes.upsertHole({
      tripId, gameId, groupingId, holeNumber,
      result: winnerId ? "won" : "tied",
      winnerId,
    });
  }
}

/** Two groupings, five holes each — a round in progress. Owner 3, planner 1,
 *  member 1, outsider 2 skins so far. */
const holesFor = (g1: string, g2: string): Hole[] => [
  [g1, 1, owner], [g1, 2, owner], [g1, 3, owner], [g1, 4, planner], [g1, 5, null],
  [g2, 1, member], [g2, 2, outsider], [g2, 3, outsider],
];

describe("skins — the live projection is what the board banks", () => {
  it("in a team tournament: by team, through the finalize's team roll-up", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Skins parity — teams", scoringModel: "points",
      members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
    });
    const alpha = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
    const bravo = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
    const assign = await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: owner, team_id: alpha },
      { competition_id: competitionId, user_id: member, team_id: alpha },
      { competition_id: competitionId, user_id: planner, team_id: bravo },
      { competition_id: competitionId, user_id: outsider, team_id: bravo },
    ]);
    expect(assign.error).toBeNull();

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "Skins", competitionId,
      pointsDistribution: { type: "placement", values: [6, 2] },
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner, member, outsider] });
    const g1 = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    const g2 = await ctx.groupStrokeParticipants(game.id, [member, outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await play(tripId, game.id, holesFor(g1, g2));

    const live = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(live.cannotProject[game.id]).toBeUndefined();
    const projected = live.projections[game.id];
    // Alpha 3 + 1 = 4 skins, Bravo 1 + 2 = 3 → Alpha 1st (6), Bravo 2nd (2).
    expect(projected).toEqual({ [alpha]: 6, [bravo]: 2 });

    await ctx.caller().games.finish({ tripId, gameId: game.id });
    const banked = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    const before = live.unitTotals as Record<string, number>;
    const after = banked.unitTotals as Record<string, number>;
    // What finishing ADDED to each team is exactly what was projected.
    expect({ [alpha]: after[alpha] - (before[alpha] ?? 0), [bravo]: after[bravo] - (before[bravo] ?? 0) }).toEqual(projected);
  });

  it("in a teamless race: by PERSON, as the finalize's user rows", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Skins parity — teamless", scoringModel: "points",
      members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
    });
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "Skins", competitionId,
      pointsDistribution: { type: "placement", values: [6, 3, 1] },
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner, member, outsider] });
    const g1 = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    const g2 = await ctx.groupStrokeParticipants(game.id, [member, outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await play(tripId, game.id, holesFor(g1, g2));

    const live = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(live.teamless).toBe(true);
    const projected = live.projections[game.id];
    // owner 3 (1st, 6); outsider 2 (2nd, 3); planner and member 1 each, tied
    // 3rd–4th, sharing 1 + 0 → ½ each.
    expect(projected).toEqual({ [owner]: 6, [outsider]: 3, [planner]: 0.5, [member]: 0.5 });

    await ctx.caller().games.finish({ tripId, gameId: game.id });
    const banked = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    const before = live.unitTotals as Record<string, number>;
    const after = banked.unitTotals as Record<string, number>;
    const added = Object.fromEntries([owner, planner, member, outsider].map((id) => [id, after[id] - (before[id] ?? 0)]));
    expect(added).toEqual(projected);
  });
});

/**
 * A grouping that has not teed off is ABSENT, not on 0 skins.
 *
 * The finalize banks only groupings that have recorded something (its comment
 * names the incident: unplayed players all on 0 tied for a place and took
 * points they never played for). The live projection must agree, or a round
 * in progress would hand a share of the places to people who have not started.
 * Both fixtures above have every grouping playing, so they cannot see this.
 */
describe("skins — an unstarted grouping projects nothing", () => {
  it("in a teamless race, only the grouping that has played takes places", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Skins parity — one grouping out", scoringModel: "points",
      members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
    });
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "Skins", competitionId,
      pointsDistribution: { type: "placement", values: [6, 3, 1] },
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner, member, outsider] });
    const g1 = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.groupStrokeParticipants(game.id, [member, outsider]); // not yet teed off
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await play(tripId, game.id, [[g1, 1, owner], [g1, 2, owner], [g1, 3, planner]]);

    const live = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    // owner 2 skins (1st, 6), planner 1 (2nd, 3). The second grouping takes no
    // place — on 0 they would have tied 3rd–4th and shared the 1.
    expect(live.projections[game.id]).toEqual({ [owner]: 6, [planner]: 3, [member]: 0, [outsider]: 0 });

    await ctx.caller().games.finish({ tripId, gameId: game.id });
    const banked = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    const before = live.unitTotals as Record<string, number>;
    const after = banked.unitTotals as Record<string, number>;
    const added = Object.fromEntries([owner, planner, member, outsider].map((id) => [id, after[id] - (before[id] ?? 0)]));
    expect(added).toEqual(live.projections[game.id]);
  });
});
