import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

// Team-identity: roster-removal lock once scoring starts. Asymmetric — removals
// (remove / trade-move / team-delete) freeze at first score; ADDS always pass.
//
// EVERY CASE BUILDS ITS OWN CUP (#1527). The cases shared one, and the "after
// the first score" block's beforeAll LOCKED it by recording a score. Shuffled,
// that hook ran before the "before the first score" case, which then met a
// locked roster. The locked cases each get their own locked cup too: they
// exercise destructive writes, and on a build whose guard failed open one of
// them would remove a player another case was counting on (CLAUDE.md, "a test
// that exercises a destructive write must not share state with the next one").
let ctx: TestContext;
let ownerId: string;
let memberId: string;
let plannerId: string;

type Cup = { tripId: string; competitionId: string; teamA: string; teamB: string };

async function rosterCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Roster Lock ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Member"); // the post-lock "pure add"
  // A POINTS cup. The roster lock is type-agnostic, but these cases DELETE
  // teams — and a head-to-head cup is exactly two teams, refusing the loss of
  // one before the lock is ever consulted (ruling 2, PR 4). A points race is
  // the only cup where team deletion, and so this lock on it, is reachable.
  const competitionId = await ctx.createCompetition(tripId, `Roster Lock Cup ${label}`, { scoringModel: "points" });
  const teamA = await ctx.createTeam(competitionId, "Team A");
  const teamB = await ctx.createTeam(competitionId, "Team B");
  return { tripId, competitionId, teamA, teamB };
}

/**
 * Member on A and owner on B, assigned WHILE still unlocked, then locked by a
 * game with a score (the first-score signal). Asserted locked before returning.
 */
async function lockedCup(label: string): Promise<Cup> {
  const cup = await rosterCup(label);
  const { tripId, competitionId, teamA, teamB } = cup;
  await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA });
  await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: ownerId, teamId: teamB });
  const gameId = genId("rl-game");
  const g = await ctx.admin.from("games").insert({
    id: gameId, trip_id: tripId, competition_id: competitionId,
    game_type_id: "gtt_stroke_play", name: "Locker", status: "active", // a points-cup format
    points_distribution: { type: "per_match", value: 2 },
  });
  if (g.error) throw new Error(`games insert failed: ${g.error.message}`);
  const { error } = await ctx.admin.from("score_entries").insert({
    id: genId("se"), game_id: gameId, participant_id: ownerId,
    participant_type: "user", unit_label: "1", value: 4,
  });
  if (error) throw new Error(`score_entries insert failed: ${error.message}`);
  expect(await ctx.caller().teamAssignments.rosterLocked({ tripId, competitionId })).toBe(true);
  return cup;
}

async function teamOf(competitionId: string, userId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("team_assignments")
    .select("team_id")
    .eq("competition_id", competitionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`read assignment: ${error.message}`);
  return (data?.team_id as string | undefined) ?? null;
}

async function teamExists(teamId: string): Promise<boolean> {
  const { data, error } = await ctx.admin.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (error) throw new Error(`read team: ${error.message}`);
  return data !== null;
}

describe("roster-removal lock", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    plannerId = ctx.getUser("planner").id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe("before the first score — full roster editing", () => {
    it("assign (add), move/trade, remove, and team-delete all succeed", async () => {
      const { tripId, competitionId, teamA, teamB } = await rosterCup("unlocked");
      const caller = ctx.caller();
      // Premise, and the control for "rosterLocked reports true" below.
      expect(await caller.teamAssignments.rosterLocked({ tripId, competitionId })).toBe(false);

      await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamA }); // add
      expect(await teamOf(competitionId, memberId)).toBe(teamA);
      await caller.teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB }); // move
      expect(await teamOf(competitionId, memberId)).toBe(teamB);
      const removed = await caller.teamAssignments.remove({ tripId, competitionId, userId: memberId });
      expect(removed).toEqual({ success: true });
      expect(await teamOf(competitionId, memberId)).toBeNull();
      const tmp = await ctx.createTeam(competitionId, "Temp Team");
      const del = await caller.teams.delete({ tripId, teamId: tmp });
      expect(del).toEqual({ success: true });
      expect(await teamExists(tmp)).toBe(false);
    });
  });

  describe("after the first score — removals locked, adds allowed", () => {
    it("a pure ADD (player with no prior team) still succeeds", async () => {
      const { tripId, competitionId, teamA } = await lockedCup("pure-add");
      expect(await teamOf(competitionId, plannerId)).toBeNull(); // premise: no prior team
      const added = await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: plannerId, teamId: teamA });
      expect(added.team_id).toBe(teamA);
    });

    it("remove is blocked", async () => {
      const { tripId, competitionId, teamA } = await lockedCup("remove");
      await expect(
        ctx.caller().teamAssignments.remove({ tripId, competitionId, userId: memberId })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await teamOf(competitionId, memberId)).toBe(teamA);
    });

    it("a move/trade (assign to a DIFFERENT team) is blocked", async () => {
      const { tripId, competitionId, teamA, teamB } = await lockedCup("move");
      await expect(
        ctx.caller().teamAssignments.assign({ tripId, competitionId, userId: memberId, teamId: teamB })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await teamOf(competitionId, memberId)).toBe(teamA);
    });

    it("team-delete (mass removal) is blocked", async () => {
      const { tripId, teamB } = await lockedCup("team-delete");
      await expect(
        ctx.caller().teams.delete({ tripId, teamId: teamB })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await teamExists(teamB)).toBe(true);
    });

    it("rosterLocked query reports true", async () => {
      const { tripId, competitionId } = await lockedCup("query");
      const locked = await ctx.caller().teamAssignments.rosterLocked({ tripId, competitionId });
      expect(locked).toBe(true);
    });
  });
});
