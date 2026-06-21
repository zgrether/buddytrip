import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import type { PointsDistribution } from "../../lib/pointsDistribution";

/**
 * Slice D1 — competition-game unification behavior (§5/§6/§8).
 * Phase-1 shell, the universal placement roll-up (manual adapter + averaged ties
 * + win number), dropping recomputes, and per-game organizer delegation.
 */

const MANUAL = "gtt_manual";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let memberId: string;
const gameIds: string[] = [];

async function newGame(distribution: PointsDistribution | null, name = "Game") {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name,
    competitionId,
    pointsDistribution: distribution,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

const DIST_9642: PointsDistribution = { type: "placement", values: [9, 6, 4, 2] };
const DIST_96: PointsDistribution = { type: "placement", values: [9, 6] };

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("D1 Trip");
  await ctx.addTripMember(tripId, "member", "Member"); // a plain trip Member (delegate target)
  memberId = ctx.getUser("member").id;
  // Placement/manual-adapter roll-up suite — points model (DB default is now
  // match_play, which would award these manual games winner-take-all).
  competitionId = await ctx.createCompetition(tripId, "D1 Comp", { scoringModel: "points" });
  teamA = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  teamB = await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_results").delete().eq("game_id", id);
    await ctx.admin.from("game_delegates").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

describe("Phase-1 shell + leaderboard (§3/§6)", () => {
  it("a game with all Phase-2 fields null is creatable and contributes points-available", async () => {
    const id = await newGame(DIST_9642, "Shell");
    const game = (await ctx.caller().games.getById({ tripId, gameId: id })) as {
      scorecard_schema: unknown;
      course_id: unknown;
      points_distribution: PointsDistribution;
      status: string;
    };
    expect(game.scorecard_schema).toBeNull(); // Phase-2 null…
    expect(game.course_id).toBeNull();
    expect(game.points_distribution).toEqual({ type: "placement", values: [9, 6, 4, 2] }); // …but Phase-1 set
    expect(game.status).toBe("pending");

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(lb.pointsAvailable).toBe(15); // sum(dist[0..1]) for 2 teams
    expect(lb.winNumber).toBe(8); // > half of 15
    expect(lb.teamTotals[teamA]).toBe(0); // nothing awarded yet
  });
});

describe("manual adapter → universal roll-up (§5)", () => {
  it("entered per-team placements write game_results and roll up to distribution points", async () => {
    const id = await newGame(DIST_9642, "Pickem");
    await ctx.caller().games.setManualResults({
      tripId,
      gameId: id,
      placements: [
        { entityId: teamA, position: 1 },
        { entityId: teamB, position: 2 },
      ],
    });
    // Only this game is live with results; the Shell game contributes available only.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(lb.teamTotals[teamA]).toBe(9); // 1st
    expect(lb.teamTotals[teamB]).toBe(6); // 2nd
  });

  it("averaged ties flow through the stack (two teams tie 1st on [9,6] → 7.5 each)", async () => {
    // Fresh competition so totals are isolated.
    const comp2 = await ctx.createCompetition(tripId, "Tie Comp", { scoringModel: "points" });
    const tA = await ctx.createTeam(comp2, "A");
    const tB = await ctx.createTeam(comp2, "B");
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Tie", competitionId: comp2,
      pointsDistribution: { type: "placement", values: [9, 6] },
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.caller().games.setManualResults({
      tripId, gameId: g.id,
      placements: [{ entityId: tA, position: 1 }, { entityId: tB, position: 1 }],
    });
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp2 });
    expect(lb.teamTotals[tA]).toBe(7.5); // (9+6)/2
    expect(lb.teamTotals[tB]).toBe(7.5);
    expect(lb.pointsAvailable).toBe(15); // invariant under the tie
  });
});

describe("dropping recomputes the win number (§4/§6)", () => {
  it("dropping a game lowers points-available + win number; restoring raises them", async () => {
    const comp3 = await ctx.createCompetition(tripId, "Drop Comp", { scoringModel: "points" });
    await ctx.createTeam(comp3, "A");
    await ctx.createTeam(comp3, "B");
    const g1 = (await ctx.caller().games.create({ tripId, gameTypeId: MANUAL, name: "G1", competitionId: comp3, pointsDistribution: DIST_96 })) as { id: string };
    const g2 = (await ctx.caller().games.create({ tripId, gameTypeId: MANUAL, name: "G2", competitionId: comp3, pointsDistribution: DIST_96 })) as { id: string };
    gameIds.push(g1.id, g2.id);

    let lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp3 });
    expect(lb.pointsAvailable).toBe(30);
    expect(lb.winNumber).toBe(15.5);

    await ctx.caller().games.setStatus({ tripId, gameId: g2.id, status: "dropped" });
    lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp3 });
    expect(lb.pointsAvailable).toBe(15); // dropped game excluded
    expect(lb.winNumber).toBe(8); // the win number MOVED

    await ctx.caller().games.setStatus({ tripId, gameId: g2.id, status: "pending" });
    lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp3 });
    expect(lb.pointsAvailable).toBe(30); // restored
  });
});

describe("per-game organizer delegation (§8)", () => {
  it("a delegated organizer can edit THEIR game but not another; non-members blocked", async () => {
    const mine = await newGame(DIST_96, "Pickem-BJ");
    const other = await newGame(DIST_96, "Scramble");
    await ctx.caller().games.addOrganizer({ tripId, gameId: mine, userId: memberId });

    const member = ctx.callerAs("member");
    // Can edit the delegated game…
    await expect(member.games.setStatus({ tripId, gameId: mine, status: "active" })).resolves.toBeTruthy();
    // …but NOT another game (game-isolated).
    await expect(member.games.setStatus({ tripId, gameId: other, status: "active" })).rejects.toThrow(/Organizer|game-organizer/i);
    // Owner can edit both.
    await expect(ctx.caller().games.setStatus({ tripId, gameId: other, status: "active" })).resolves.toBeTruthy();
    // A non-member (outsider) is blocked outright.
    await expect(ctx.callerAs("outsider").games.setStatus({ tripId, gameId: mine, status: "active" })).rejects.toThrow();
  });

  it("a plain trip member with no grant cannot edit a game", async () => {
    const g = await newGame(DIST_96, "NoGrant");
    await expect(ctx.callerAs("member").games.setStatus({ tripId, gameId: g, status: "active" })).rejects.toThrow(/Organizer|game-organizer/i);
  });

  it("myDelegateGameIds returns only the games the caller delegates (board marking, §10)", async () => {
    const mine = await newGame(DIST_96, "Mine-BJ");
    const notMine = await newGame(DIST_96, "NotMine");
    await ctx.caller().games.addOrganizer({ tripId, gameId: mine, userId: memberId });

    const memberIds = await ctx.callerAs("member").games.myDelegateGameIds({ tripId });
    expect(memberIds).toContain(mine);
    expect(memberIds).not.toContain(notMine);

    // The owner (no game-level grant) doesn't see these flagged as "theirs".
    const ownerIds = await ctx.caller().games.myDelegateGameIds({ tripId });
    expect(ownerIds).not.toContain(mine);
  });
});
