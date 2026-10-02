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
let memberId: string;
const gameIds: string[] = [];

type Cup = { tripId: string; competitionId: string; teamA: string; teamB: string };

/**
 * A points cup of its own (#1527), for the cases that read the CUP's totals.
 * The file's shared cup accumulates every other case's games, so a total read
 * there depended on which cases had run first (the shell case read 135 points
 * available where its own game contributes 15).
 */
async function ownCup(label: string): Promise<Cup> {
  const { tripId: t, competitionId: c } = await ctx.createCupTrip({ name: `D1 ${label}`, scoringModel: "points" });
  const a = await ctx.createTeam(c, "Blue", { shortName: "BLU" });
  const b = await ctx.createTeam(c, "Red", { shortName: "RED" });
  return { tripId: t, competitionId: c, teamA: a, teamB: b };
}

async function newGame(distribution: PointsDistribution | null, name = "Game", cup?: Cup) {
  const g = (await ctx.caller().games.create({
    tripId: cup?.tripId ?? tripId,
    gameTypeId: MANUAL,
    name,
    competitionId: cup?.competitionId ?? competitionId,
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
  await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_results").delete().eq("game_id", id);
    await ctx.admin.from("game_delegates").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

// Through `games.finish({ placements })` — the manual finalize, the app's only
// live path for these rows. This file used `setManualResults`, which no client
// calls and which writes placements on an UNFINISHED game; since #1416 the
// board banks a game only once it is finished, so those rows would read as
// nothing. Same input shape, same writer (`writeManualResults`).
describe("Phase-1 shell + leaderboard (§3/§6)", () => {
  it("a game with all Phase-2 fields null is creatable and contributes points-available", async () => {
    const cup = await ownCup("shell");
    const id = await newGame(DIST_9642, "Shell", cup);
    const game = (await ctx.caller().games.getById({ tripId: cup.tripId, gameId: id })) as {
      scorecard_schema: unknown;
      course_id: unknown;
      points_distribution: PointsDistribution;
      status: string;
    };
    expect(game.scorecard_schema).toBeNull(); // Phase-2 null…
    expect(game.course_id).toBeNull();
    expect(game.points_distribution).toEqual({ type: "placement", values: [9, 6, 4, 2] }); // …but Phase-1 set
    expect(game.status).toBe("pending");

    const lb = await ctx.caller().competitions.leaderboard({ tripId: cup.tripId, competitionId: cup.competitionId });
    expect(lb.pointsAvailable).toBe(15); // sum(dist[0..1]) for 2 teams
    expect(lb.winNumber).toBe(8); // > half of 15
    expect(lb.teamTotals[cup.teamA]).toBe(0); // nothing awarded yet
  });
});

describe("manual adapter → universal roll-up (§5)", () => {
  it("entered per-team placements write game_results and roll up to distribution points", async () => {
    // Its own cup, so the totals are this game's alone (#1527) — on the shared
    // cup they included whatever other cases had banked.
    const cup = await ownCup("adapter");
    const id = await newGame(DIST_9642, "Pickem", cup);
    await ctx.caller().games.finish({
      tripId: cup.tripId,
      gameId: id,
      placements: [
        { entityId: cup.teamA, position: 1 },
        { entityId: cup.teamB, position: 2 },
      ],
    });
    const lb = await ctx.caller().competitions.leaderboard({ tripId: cup.tripId, competitionId: cup.competitionId });
    expect(lb.teamTotals[cup.teamA]).toBe(9); // 1st
    expect(lb.teamTotals[cup.teamB]).toBe(6); // 2nd
  });

  it("averaged ties flow through the stack (two teams tie 1st on [9,6] → 7.5 each)", async () => {
    // Fresh competition so totals are isolated — on its own trip, since a trip
    // holds one competition (migration 195).
    const { tripId: tieTripId, competitionId: comp2 } = await ctx.createCupTrip({ name: "Tie Comp", scoringModel: "points" });
    const tA = await ctx.createTeam(comp2, "A");
    const tB = await ctx.createTeam(comp2, "B");
    const g = (await ctx.caller().games.create({
      tripId: tieTripId, gameTypeId: MANUAL, name: "Tie", competitionId: comp2,
      pointsDistribution: { type: "placement", values: [9, 6] },
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.caller().games.finish({
      tripId: tieTripId, gameId: g.id,
      placements: [{ entityId: tA, position: 1 }, { entityId: tB, position: 1 }],
    });
    const lb = await ctx.caller().competitions.leaderboard({ tripId: tieTripId, competitionId: comp2 });
    expect(lb.teamTotals[tA]).toBe(7.5); // (9+6)/2
    expect(lb.teamTotals[tB]).toBe(7.5);
    expect(lb.pointsAvailable).toBe(15); // invariant under the tie
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
    await expect(ctx.callerAs("outsider").games.setStatus({ tripId, gameId: mine, status: "active" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("You are not a member of this trip") });
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

    // The owner (no game-level grant) doesn't see EITHER flagged as "theirs" —
    // the marker means "I'm personally running this," and the owner running a
    // game by default is the ordinary case, not something to self-mark.
    const ownerIds = await ctx.caller().games.myDelegateGameIds({ tripId });
    expect(ownerIds).not.toContain(mine);
    expect(ownerIds).not.toContain(notMine);
  });

  it("delegatesByTrip surfaces every explicit grant, for the Owner's 'who did I hand this off to' chip", async () => {
    const delegated = await newGame(DIST_96, "Delegated-BJ");
    const undelegated = await newGame(DIST_96, "Undelegated");
    await ctx.caller().games.addOrganizer({ tripId, gameId: delegated, userId: memberId });

    const grants = (await ctx.caller().games.delegatesByTrip({ tripId })) as { gameId: string; userId: string }[];
    expect(grants).toContainEqual({ gameId: delegated, userId: memberId });
    // The undelegated game has no row at all — it's the Owner's implicit
    // default, not a grant to surface.
    expect(grants.some((g) => g.gameId === undelegated)).toBe(false);

    // Any trip member can read it (matches game_delegates_select) — the UI is
    // what restricts rendering to the Owner, not the data.
    const asMember = (await ctx.callerAs("member").games.delegatesByTrip({ tripId })) as { gameId: string; userId: string }[];
    expect(asMember).toContainEqual({ gameId: delegated, userId: memberId });
  });
});
