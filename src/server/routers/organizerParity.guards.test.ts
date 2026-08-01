import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * #786 part 2 — the tRPC half of Organizer parity, paired with migration 101.
 *
 * ENUMERATED, NOT SAMPLED. Every procedure whose guard moved gets both cases:
 * an Organizer is admitted, and a Member is refused. Every procedure that
 * DELIBERATELY did not move gets a refusal case, so a later sweep can't quietly
 * widen one of them without a red test — the held-back set is the part most
 * likely to be "finished" by someone who reads only the issue title.
 *
 * "planner" is the shared test user holding the trip role `Organizer` (the
 * fixture name predates migration 029's rename).
 *
 * An Organizer case asserts NOT-FORBIDDEN rather than success: several of these
 * procedures do real work with their own preconditions (a roster lock, an email
 * send, a missing row), and this file is about the permission boundary. A
 * FORBIDDEN is the failure it exists to catch; any other outcome means the gate
 * admitted the caller, which is the claim under test.
 */
async function forbidden(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof TRPCError && e.code === "FORBIDDEN";
  }
}

describe("#786 — Organizer parity at the tRPC guard layer", () => {
  let ctx: TestContext;
  let tripId: string;
  let competitionId: string;
  let teamId: string;
  let windowId: string;
  let memberId: string;
  let organizerId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Guard Parity Trip");
    // Sequential, never Promise.all — these race (CLAUDE.md).
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    organizerId = ctx.getUser("planner").id;
    memberId = ctx.getUser("member").id;

    competitionId = await ctx.createCompetition(tripId, "Guard Parity Cup");
    teamId = await ctx.createTeam(competitionId, "Guard Team");

    windowId = genId("dw");
    await ctx.admin.from("date_windows").insert({
      id: windowId,
      trip_id: tripId,
      start_date: "2027-06-01",
      end_date: "2027-06-04",
    });
  });

  afterAll(async () => {
    await ctx.admin.from("date_poll_votes").delete().eq("window_id", windowId);
    await ctx.admin.from("date_windows").delete().eq("id", windowId);
    await ctx.admin.from("invites").delete().eq("trip_id", tripId);
    await ctx.admin.from("ideas").delete().eq("trip_id", tripId);
    await ctx.admin.from("archived_ideas").delete().eq("user_id", organizerId);
    await ctx.cleanup();
  });

  // =========================================================================
  // MOVED — Organizer admitted, Member refused
  // =========================================================================

  describe("ideas.create", () => {
    const input = () => ({
      tripId,
      id: genId("idea"),
      title: "Parity Idea",
      location: "Somewhere",
    });

    it("admits an Organizer", async () => {
      expect(await forbidden(() => ctx.callerAs("planner").ideas.create(input()))).toBe(false);
    });
    it("refuses a Member", async () => {
      expect(await forbidden(() => ctx.callerAs("member").ideas.create(input()))).toBe(true);
    });
  });

  describe("ideas.remove", () => {
    async function seedIdea() {
      const id = genId("idea");
      await ctx.admin
        .from("ideas")
        .insert({ id, trip_id: tripId, title: "Removable", location: "X" });
      return id;
    }

    it("admits an Organizer", async () => {
      const ideaId = await seedIdea();
      expect(
        await forbidden(() => ctx.callerAs("planner").ideas.remove({ tripId, ideaId }))
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      const ideaId = await seedIdea();
      expect(
        await forbidden(() => ctx.callerAs("member").ideas.remove({ tripId, ideaId }))
      ).toBe(true);
    });
  });

  describe("archivedIdeas.archive", () => {
    async function seedIdea() {
      const id = genId("idea");
      await ctx.admin
        .from("ideas")
        .insert({ id, trip_id: tripId, title: "Archivable", location: "X" });
      return id;
    }

    it("admits an Organizer", async () => {
      const ideaId = await seedIdea();
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").archivedIdeas.archive({ tripId, ideaId })
        )
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      const ideaId = await seedIdea();
      expect(
        await forbidden(() =>
          ctx.callerAs("member").archivedIdeas.archive({ tripId, ideaId })
        )
      ).toBe(true);
    });
  });

  describe("trips.lockDestination", () => {
    const input = () => ({ tripId, title: "Bandon Dunes", location: "Bandon, OR" });

    it("admits an Organizer", async () => {
      expect(
        await forbidden(() => ctx.callerAs("planner").trips.lockDestination(input()))
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      expect(
        await forbidden(() => ctx.callerAs("member").trips.lockDestination(input()))
      ).toBe(true);
    });
  });

  describe("datePoll.castVoteForMember", () => {
    const input = () => ({
      tripId,
      windowId,
      userId: memberId,
      answer: "yes" as const,
    });

    it("admits an Organizer", async () => {
      expect(
        await forbidden(() => ctx.callerAs("planner").datePoll.castVoteForMember(input()))
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      expect(
        await forbidden(() => ctx.callerAs("member").datePoll.castVoteForMember(input()))
      ).toBe(true);
    });
  });

  describe("teamAssignments.remove", () => {
    async function seedAssignment() {
      await ctx.admin.from("team_assignments").upsert({
        competition_id: competitionId,
        user_id: memberId,
        team_id: teamId,
      });
    }
    const input = () => ({ tripId, competitionId, userId: memberId });

    it("admits an Organizer", async () => {
      await seedAssignment();
      expect(
        await forbidden(() => ctx.callerAs("planner").teamAssignments.remove(input()))
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      await seedAssignment();
      expect(
        await forbidden(() => ctx.callerAs("member").teamAssignments.remove(input()))
      ).toBe(true);
    });
  });

  describe("tripMembers.inviteByEmail", () => {
    const input = () => ({
      tripId,
      email: `parity-${genId("e")}@example.test`,
      role: "Member" as const,
    });

    it("admits an Organizer", async () => {
      expect(
        await forbidden(() => ctx.callerAs("planner").tripMembers.inviteByEmail(input()))
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      expect(
        await forbidden(() => ctx.callerAs("member").tripMembers.inviteByEmail(input()))
      ).toBe(true);
    });
  });

  describe("tripMembers.sendInvitationBlast", () => {
    it("admits an Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.sendInvitationBlast({ tripId, memberUserIds: [memberId] })
        )
      ).toBe(false);
    });
    it("refuses a Member", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("member").tripMembers.sendInvitationBlast({ tripId, memberUserIds: [memberId] })
        )
      ).toBe(true);
    });
  });

  describe("games.delete / .resetScoring / .resetToSkeleton", () => {
    async function seedGame() {
      const gameId = genId("guard-game");
      await ctx.admin.from("games").insert({
        id: gameId,
        trip_id: tripId,
        competition_id: competitionId,
        game_type_id: "gtt_match_play",
        name: "Guard Game",
        status: "complete",
        scoring_enabled: true,
      });
      return gameId;
    }

    it("delete admits an Organizer", async () => {
      const gameId = await seedGame();
      expect(
        await forbidden(() => ctx.callerAs("planner").games.delete({ tripId, gameId }))
      ).toBe(false);
    });
    it("delete refuses a Member", async () => {
      const gameId = await seedGame();
      expect(
        await forbidden(() => ctx.callerAs("member").games.delete({ tripId, gameId }))
      ).toBe(true);
    });

    it("resetScoring admits an Organizer", async () => {
      const gameId = await seedGame();
      expect(
        await forbidden(() => ctx.callerAs("planner").games.resetScoring({ tripId, gameId }))
      ).toBe(false);
    });
    it("resetScoring refuses a Member", async () => {
      const gameId = await seedGame();
      expect(
        await forbidden(() => ctx.callerAs("member").games.resetScoring({ tripId, gameId }))
      ).toBe(true);
    });

    it("resetToSkeleton admits an Organizer", async () => {
      const gameId = await seedGame();
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").games.resetToSkeleton({ tripId, gameId })
        )
      ).toBe(false);
    });
    it("resetToSkeleton refuses a Member", async () => {
      const gameId = await seedGame();
      expect(
        await forbidden(() =>
          ctx.callerAs("member").games.resetToSkeleton({ tripId, gameId })
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // NOT MOVED — the five sanctioned exceptions stay Owner-only
  // =========================================================================
  describe("the sanctioned exceptions still refuse an Organizer", () => {
    it("1 — tripMembers.updateRole", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.updateRole({
            tripId,
            userId: memberId,
            role: "Organizer",
          })
        )
      ).toBe(true);
    });

    it("2 — trips.delete", async () => {
      expect(await forbidden(() => ctx.callerAs("planner").trips.delete({ tripId }))).toBe(
        true
      );
    });

    it("3 — trips.transferOwnership", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").trips.transferOwnership({ tripId, newOwnerId: memberId })
        )
      ).toBe(true);
    });

    it("4 — competitions.delete", async () => {
      // Gated by requireCompetitionRole("owner") + assert_competition_owner,
      // NOT requireTripRole — so it was never in the deviation set at all.
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").competitions.delete({ tripId, competitionId })
        )
      ).toBe(true);
    });

    it("5 — messages.clearChannel", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").messages.clearChannel({ tripId, visibility: "crew" })
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // HELD BACK — deviations that could NOT move in this change, each blocked by
  // a specific gate. These are still deviations from the ratified rule; the
  // tests pin the CURRENT state so a later sweep is a deliberate act.
  // =========================================================================
  describe("held back — still Owner-only, with a blocking reason", () => {
    // Blocked by: RLS is row-granular. Widening trip_members INSERT/UPDATE/
    // DELETE lets an Organizer set any member's role via direct PostgREST,
    // including their own to 'Owner'. Needs a role-column trigger first.
    it("tripMembers.add (trip_members cluster)", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.add({
            tripId,
            userId: ctx.getUser("outsider").id,
          })
        )
      ).toBe(true);
    });

    it("tripMembers.remove (trip_members cluster)", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.remove({ tripId, userId: memberId })
        )
      ).toBe(true);
    });

    it("tripMembers.updateNickname (trip_members cluster)", async () => {
      expect(
        await forbidden(() =>
          ctx
            .callerAs("planner")
            .tripMembers.updateNickname({ tripId, userId: memberId, nickname: "Nope" })
        )
      ).toBe(true);
    });

    it("ghostCrew.create (trip_members cluster)", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").ghostCrew.create({ tripId, name: "Held Guest" })
        )
      ).toBe(true);
    });

    // Blocked by: link_guest_to_account (migration 095) hardcodes an Owner
    // check inside the guest -> real-user MERGE path, which runs in the signup
    // trigger. Widening tRPC alone would half-open this: editing a name would
    // work, pasting an email that matches an account would fail at the DB.
    it("ghostCrew.update (blocked by link_guest_to_account)", async () => {
      expect(
        await forbidden(() =>
          ctx
            .callerAs("planner")
            .ghostCrew.update({ tripId, guestUserId: memberId, name: "Nope" })
        )
      ).toBe(true);
    });

    // Blocked by: set_team_captain calls the SHARED assert_competition_owner,
    // which also guards delete_competition_cascade — i.e. exception 4. Widening
    // the shared assert would widen competitions.delete, so this one needs the
    // assert split before it can move. It is also arguably an exception rather
    // than a deviation: a captain holds real RLS grants (migrations 065 / 094),
    // so appointing one may be "changing who is trusted" one level down.
    it("teamAssignments.setCaptain (blocked by a shared assert; may be an exception)", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").teamAssignments.setCaptain({
            tripId,
            competitionId,
            teamId,
            userId: memberId,
            isCaptain: true,
          })
        )
      ).toBe(true);
    });
  });
});
