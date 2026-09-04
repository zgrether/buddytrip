import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * competitions.faceBootstrap — the Stage-A single boundary resolve.
 *
 * One call returns the competition's STRUCTURE: competition + teams + games +
 * assignments, the viewer's live-derived competition role, and their delegated
 * game ids. These tests assert that structure is present, the no-competition
 * case is clean, and the role is derived in both directions
 * (owner/co-admin/member).
 *
 * It used to carry the leaderboard roll-up as well. It does not any more
 * (#1281 step 1) — that was the STATE half, 9 of the procedure's 14 Supabase
 * reads, and the only field in it a score entry changed. Its absence is pinned
 * below rather than merely unasserted.
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
  competitionId = await ctx.createCompetition(tripId, "Bootstrap Cup", { scoringModel: "points" });
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
  await ctx.admin.from("game_delegates").delete().eq("game_id", gameId);
  await ctx.admin.from("game_results").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

describe("faceBootstrap — both states in one resolve", () => {
  it("returns the shared STRUCTURE base for the owner", async () => {
    const boot = await ctx.caller().competitions.faceBootstrap({ tripId });
    expect(boot.competition?.id).toBe(competitionId);
    expect(boot.myCompetitionRole).toBe("owner");
    expect(boot.teams.length).toBe(2); // shared base (setup guide + board)
    expect((boot.games as { id: string }[]).some((g) => g.id === gameId)).toBe(true);
  });

  /**
   * THE SPLIT, PINNED (#1281 step 1) — asserted as an ABSENCE on purpose.
   *
   * These three assertions used to say the opposite: that the roll-up was
   * present and populated. Deleting them would have left the removal
   * unguarded, and the field is cheap to re-add by accident — it is one line
   * in a `Promise.all` and it would look like an optimisation ("one round trip
   * instead of two on cold open") to anyone who had not measured it.
   *
   * It was 9 of this procedure's 14 Supabase reads and the ONLY score-derived
   * field in it, so re-adding it puts the whole competition standings back on
   * the structure refetch that every score event triggers on every client.
   */
  it("does NOT carry the leaderboard roll-up — that is the state half", async () => {
    const boot = await ctx.caller().competitions.faceBootstrap({ tripId });
    expect(Object.hasOwn(boot, "leaderboard")).toBe(false);
  });

  /**
   * The other side of the same claim: removing it from the bootstrap must not
   * have removed it from the app. An absence assertion alone would pass just as
   * happily if the standings had stopped being computed anywhere at all.
   */
  it("...and competitions.leaderboard still serves the same roll-up", async () => {
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(lb.teams.length).toBe(2);
    expect(lb.pointsAvailable).toBeGreaterThan(0);
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
    expect(Object.hasOwn(boot, "leaderboard")).toBe(false);
    expect(boot.teams).toEqual([]);
    expect(boot.games).toEqual([]);
    expect(boot.myDelegateGameIds).toEqual([]);
    expect(boot.myCompetitionRole).toBe("owner"); // role still resolves
  });
});
