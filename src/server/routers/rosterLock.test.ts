import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

// Team-identity: roster-removal lock once scoring starts. Asymmetric — removals
// (remove / trade-move / team-delete) freeze at first score; ADDS always pass.
let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let ownerId: string;
let memberId: string;
let plannerId: string;

describe("roster-removal lock", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Roster Lock Test");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "planner", "Member"); // the post-lock "pure add"
    competitionId = await ctx.createCompetition(tripId, "Roster Lock Cup");
    teamA = await ctx.createTeam(competitionId, "Team A");
    teamB = await ctx.createTeam(competitionId, "Team B");
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    plannerId = ctx.getUser("planner").id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("before the first score — full roster editing", () => {
    it("assign (add), move/trade, remove, and team-delete all succeed", async () => {
      const caller = ctx.caller();
      await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA }); // add
      await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB }); // move
      const removed = await caller.teamAssignments.remove({ tripId, competitionId, userId: memberId });
      expect(removed).toEqual({ success: true });
      const tmp = await ctx.createTeam(competitionId, "Temp Team");
      const del = await caller.teams.delete({ tripId, teamId: tmp });
      expect(del).toEqual({ success: true });
    });
  });

  describe("after the first score — removals locked, adds allowed", () => {
    beforeAll(async () => {
      // Assign the players we'll test WHILE still unlocked, then lock the comp by
      // inserting a game with a score (the first-score signal).
      await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA });
      await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: ownerId, teamId: teamB });
      const gameId = genId("rl-game");
      await ctx.admin.from("games").insert({
        id: gameId, trip_id: tripId, competition_id: competitionId,
        game_type_id: "gtt_match_play", name: "Locker", status: "active",
        points_distribution: { type: "per_match", value: 2 },
      });
      const { error } = await ctx.admin.from("score_entries").insert({
        id: genId("se"), game_id: gameId, participant_id: ownerId,
        participant_type: "user", unit_label: "1", value: 4,
      });
      if (error) throw new Error(`score_entries insert failed: ${error.message}`);
    });

    it("a pure ADD (player with no prior team) still succeeds", async () => {
      const added = await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: plannerId, teamId: teamA });
      expect(added.team_id).toBe(teamA);
    });

    it("remove is blocked", async () => {
      await expect(
        ctx.caller().teamAssignments.remove({ tripId, competitionId, userId: memberId })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("a move/trade (assign to a DIFFERENT team) is blocked", async () => {
      await expect(
        ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("team-delete (mass removal) is blocked", async () => {
      await expect(
        ctx.caller().teams.delete({ tripId, teamId: teamB })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("rosterLocked query reports true", async () => {
      const locked = await ctx.caller().teamAssignments.rosterLocked({ tripId, competitionId });
      expect(locked).toBe(true);
    });
  });
});
