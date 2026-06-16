import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * competitions.faceBootstrap — the Stage-A single boundary resolve.
 *
 * One call returns everything both face states need: the shared base
 * (competition + teams + games + assignments), the leaderboard roll-up, the
 * viewer's live-derived competition role, and their delegated game ids. These
 * tests assert both states' data is present, the no-competition case is clean,
 * and the role is derived in both directions (owner/co-admin/member).
 */

const MANUAL = "gtt_manual";
const DIST = { type: "placement" as const, values: [9, 6] };

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;
let memberId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Bootstrap trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // → co_admin
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "Bootstrap Cup");
  await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name: "Pickem",
    competitionId,
    pointsDistribution: DIST,
  })) as { id: string };
  gameId = g.id;
});

afterAll(async () => {
  await ctx.admin.from("game_organizers").delete().eq("game_id", gameId);
  await ctx.admin.from("game_results").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

describe("faceBootstrap — both states in one resolve", () => {
  it("returns the shared base + leaderboard for the owner", async () => {
    const boot = await ctx.caller().competitions.faceBootstrap({ tripId });
    expect(boot.competition?.id).toBe(competitionId);
    expect(boot.myCompetitionRole).toBe("owner");
    expect(boot.teams.length).toBe(2); // shared base (setup guide + board)
    expect((boot.games as { id: string }[]).some((g) => g.id === gameId)).toBe(true);
    // Leaderboard roll-up present (the board state) — same shape as the
    // competitions.leaderboard endpoint.
    expect(boot.leaderboard).not.toBeNull();
    expect(boot.leaderboard!.teams.length).toBe(2);
    expect(boot.leaderboard!.pointsAvailable).toBeGreaterThan(0);
  });

  it("derives the competition role in both directions (live, per request)", async () => {
    const asPlanner = await ctx.callerAs("planner").competitions.faceBootstrap({ tripId });
    expect(asPlanner.myCompetitionRole).toBe("co_admin");

    const asMember = await ctx.callerAs("member").competitions.faceBootstrap({ tripId });
    expect(asMember.myCompetitionRole).toBe("member");
    expect(asMember.myDelegateGameIds).not.toContain(gameId); // not a delegate yet
  });

  it("surfaces the viewer's delegated games (drives the 'Yours' marking)", async () => {
    await ctx.caller().games.addOrganizer({ tripId, gameId, userId: memberId });
    const asMember = await ctx.callerAs("member").competitions.faceBootstrap({ tripId });
    expect(asMember.myDelegateGameIds).toContain(gameId);
    // still a member-role competition role — delegate ≠ co-admin
    expect(asMember.myCompetitionRole).toBe("member");
  });
});

describe("faceBootstrap — no-competition trip is a clean state, not an error", () => {
  it("returns a null competition + empty base without throwing", async () => {
    const noCompTrip = await ctx.createTrip("No-comp trip");
    const boot = await ctx.caller().competitions.faceBootstrap({ tripId: noCompTrip });
    expect(boot.competition).toBeNull();
    expect(boot.leaderboard).toBeNull();
    expect(boot.teams).toEqual([]);
    expect(boot.games).toEqual([]);
    expect(boot.myDelegateGameIds).toEqual([]);
    expect(boot.myCompetitionRole).toBe("owner"); // role still resolves
  });
});
