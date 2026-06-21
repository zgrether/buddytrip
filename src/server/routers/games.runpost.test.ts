import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Slice D Run/Post — post the current standing, score-lock, correction → re-post,
 * and the owner/game-delegate permission boundary.
 *
 * Runs the whole cycle on a MANUAL game so the post/lock/correct logic is tested
 * without engine-compute fixtures: posting a manual game writes the entered order
 * and points come from the CONFIGURED distribution (poster sets order, not points).
 */

const MANUAL = "gtt_manual";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let memberId: string;
const gameIds: string[] = [];

async function newManualGame(name = "Cornhole") {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name,
    competitionId,
    pointsDistribution: { type: "placement", values: [5, 3] },
    pointsTotal: 8,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Run/Post Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // a trip planner (NOT a run-action)
  await ctx.addTripMember(tripId, "member", "Member"); // delegate candidate
  memberId = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "Run Cup", { scoringModel: "points" });
  teamA = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  teamB = await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
});

afterAll(async () => {
  if (gameIds.length) {
    await ctx.admin.from("score_entries").delete().in("game_id", gameIds);
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("game_delegates").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 30000);

describe("post — commit current standing, points from configured distribution", () => {
  it("manual post writes the entered ORDER; points come from the distribution", async () => {
    const g = await newManualGame();
    await ctx.caller().games.post({
      tripId, gameId: g,
      placements: [{ entityId: teamA, position: 1 }, { entityId: teamB, position: 2 }],
    });

    const game = (await ctx.caller().games.getById({ tripId, gameId: g })) as { status: string; corrections_open: boolean };
    expect(game.status).toBe("complete"); // posted/locked
    expect(game.corrections_open).toBe(false);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    // Poster set positions 1,2 — points come from the configured [5,3].
    expect(lb.teamTotals[teamA]).toBe(5);
    expect(lb.teamTotals[teamB]).toBe(3);
    expect(lb.pointsAvailable).toBe(8);
  });

  it("re-post is idempotent (re-commits current state)", async () => {
    const g = await newManualGame("Re-post game");
    const place = [{ entityId: teamA, position: 1 }, { entityId: teamB, position: 2 }];
    await ctx.caller().games.post({ tripId, gameId: g, placements: place });
    await ctx.caller().games.post({ tripId, gameId: g, placements: place });
    const game = (await ctx.caller().games.getById({ tripId, gameId: g })) as { status: string };
    expect(game.status).toBe("complete");
  });
});

describe("score lock — posted scores frozen until correction", () => {
  it("post → entry FORBIDDEN; openCorrection → entry allowed; re-post → FORBIDDEN", async () => {
    const g = await newManualGame("Lock cycle");
    const place = [{ entityId: teamA, position: 1 }, { entityId: teamB, position: 2 }];
    const entry = { tripId, gameId: g, participantId: ctx.getUser("owner").id, unitLabel: "1", value: 4 };

    await ctx.caller().games.post({ tripId, gameId: g, placements: place });
    // Locked: score entry rejected while posted & not correcting.
    await expect(ctx.caller().scores.upsertEntry(entry)).rejects.toThrow(/posted/i);

    // Enter correction → entry re-opened.
    await ctx.caller().games.openCorrection({ tripId, gameId: g });
    const correcting = (await ctx.caller().games.getById({ tripId, gameId: g })) as { corrections_open: boolean };
    expect(correcting.corrections_open).toBe(true);
    await expect(ctx.caller().scores.upsertEntry(entry)).resolves.toBeTruthy();

    // Re-post → re-locked.
    await ctx.caller().games.post({ tripId, gameId: g, placements: place });
    await expect(ctx.caller().scores.upsertEntry(entry)).rejects.toThrow(/posted/i);
  });

  it("openCorrection only applies to a POSTED game", async () => {
    const g = await newManualGame("Not posted");
    await expect(ctx.caller().games.openCorrection({ tripId, gameId: g })).rejects.toThrow(/posted/i);
  });
});

describe("permissions — run-actions: owner / co-admin / game-delegate", () => {
  it("owner can post", async () => {
    const g = await newManualGame("Owner posts");
    await expect(
      ctx.caller().games.post({ tripId, gameId: g, placements: [{ entityId: teamA, position: 1 }] })
    ).resolves.toBeTruthy();
  });

  it("a co-admin (trip Organizer) and a game-delegate can post; a plain Member cannot", async () => {
    const g = await newManualGame("Co-admin + delegate post");
    const place = [{ entityId: teamA, position: 1 }, { entityId: teamB, position: 2 }];

    // Co-admin (trip Organizer) — posting is operational (owner-minus-destructive),
    // so co-admins post now (the game-day redundancy this role exists for).
    await expect(ctx.callerAs("planner").games.post({ tripId, gameId: g, placements: place }))
      .resolves.toBeTruthy();
    // Plain Member — blocked (not co-admin, not this game's delegate).
    await expect(ctx.callerAs("member").games.post({ tripId, gameId: g, placements: place }))
      .rejects.toThrow(/co-admin|delegate/i);

    // Grant the Member the game-delegate role → now allowed.
    await ctx.caller().games.addOrganizer({ tripId, gameId: g, userId: memberId });
    await expect(ctx.callerAs("member").games.post({ tripId, gameId: g, placements: place }))
      .resolves.toBeTruthy();
  });

  it("an outsider (non-member) cannot post or correct", async () => {
    const g = await newManualGame("Outsider blocked");
    await ctx.caller().games.post({ tripId, gameId: g, placements: [{ entityId: teamA, position: 1 }] });
    await expect(ctx.callerAs("outsider").games.post({ tripId, gameId: g, placements: [{ entityId: teamA, position: 1 }] })).rejects.toThrow();
    await expect(ctx.callerAs("outsider").games.openCorrection({ tripId, gameId: g })).rejects.toThrow();
  });

  it("a co-admin (trip Organizer) can open correction", async () => {
    const g = await newManualGame("Co-admin corrects");
    await ctx.caller().games.post({ tripId, gameId: g, placements: [{ entityId: teamA, position: 1 }] });
    await expect(ctx.callerAs("planner").games.openCorrection({ tripId, gameId: g }))
      .resolves.toBeTruthy();
  });
});
