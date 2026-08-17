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
 *
 * ── WHAT THIS FILE CANNOT PROVE, and it bit us once ──────────────────────────
 * A not-FORBIDDEN assertion proves the GATE admits the caller. It says nothing
 * about whether the procedure's WRITES then succeed. `tripMembers.inviteByEmail`
 * passed here while every one of its `trip_members` inserts was refused by an
 * RLS policy that had not moved — the caller was admitted and nothing was
 * written, and because those inserts are unchecked (SILENT_WRITES_AUDIT.md
 * §4.3) the procedure still returned success. It is now in the held-back block
 * below for a second, deeper reason, but the test-shape lesson stands.
 *
 * EVERY procedure in this file has that same blind spot. When widening a guard,
 * enumerate the tables the procedure WRITES and confirm each one's policy moved
 * — a green line here is not that check. The RLS half is covered separately in
 * `organizerParity.rls.test.ts`, per policy; the two files only add up if
 * someone has matched the procedure's write set against the policy set.
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
  // THE trip_members CLUSTER — moved in #786/#824, unblocked by migration 122.
  //
  // These six sat in "held back" below until the role-column trigger existed.
  // It does now (migration 122), so RLS could widen to `is_trip_planner` and
  // the guards followed. `updateMemberTravel` and `ghostCrew.remove` are new
  // rows here — they are part of the same cluster but were never covered by
  // this file, which is why only four of the six failed when the guards moved.
  //
  // What did NOT move with them is the role GRANT, pinned at the end: an
  // Organizer may add crew, but only the Owner may make someone an Organizer.
  // Migration 122 enforces that at the database (including for a PostgREST
  // caller); these assert the tRPC half.
  // =========================================================================
  describe("trip_members cluster — moved (migration 122)", () => {
    it("tripMembers.add admits an Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.add({
            tripId,
            userId: ctx.getUser("outsider").id,
          })
        )
      ).toBe(false);
    });

    it("tripMembers.updateNickname admits an Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx
            .callerAs("planner")
            .tripMembers.updateNickname({ tripId, userId: memberId, nickname: "By Organizer" })
        )
      ).toBe(false);
    });

    it("tripMembers.updateMemberTravel admits an Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx
            .callerAs("planner")
            .tripMembers.updateMemberTravel({ tripId, targetUserId: memberId, travelMode: "driving" })
        )
      ).toBe(false);
    });

    it("ghostCrew.create admits an Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").ghostCrew.create({ tripId, name: "Organizer Guest" })
        )
      ).toBe(false);
    });

    it("ghostCrew.remove admits an Organizer", async () => {
      const g = await ctx.caller().ghostCrew.create({ tripId, name: "Removable" });
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").ghostCrew.remove({ tripId, guestUserId: g.id })
        )
      ).toBe(false);
    });

    it("tripMembers.remove admits an Organizer", async () => {
      // Removed LAST in this block: it deletes the row the earlier cases add.
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.remove({
            tripId,
            userId: ctx.getUser("outsider").id,
          })
        )
      ).toBe(false);
    });

    // ── the boundary that did NOT move ────────────────────────────────────
    it("tripMembers.add REFUSES an Organizer granting Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.add({
            tripId,
            userId: ctx.getUser("outsider").id,
            role: "Organizer",
          })
        )
      ).toBe(true);
    });

    it("ghostCrew.create REFUSES an Organizer granting Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").ghostCrew.create({
            tripId,
            name: "Should Not Exist",
            role: "Organizer",
          })
        )
      ).toBe(true);
    });

    // Migration 123 — removal is a stronger form of `updateRole`, which is
    // Owner-only. An Organizer who cannot demote a peer must not be able to
    // delete them either. Enforced by the trigger (covered directly at the
    // table in `tripMembers.removeScoping.test.ts`); this is the tRPC half.
    it("tripMembers.remove REFUSES an Organizer removing a fellow Organizer", async () => {
      // Must be a DIFFERENT Organizer: passing the caller's own id hits the
      // "Cannot remove yourself" BAD_REQUEST first, which is a separate rule
      // and would make this pass for the wrong reason.
      await ctx.admin.from("trip_members")
        .update({ role: "Organizer" }).eq("trip_id", tripId).eq("user_id", memberId);
      try {
        expect(
          await forbidden(() =>
            ctx.callerAs("planner").tripMembers.remove({ tripId, userId: memberId })
          )
        ).toBe(true);
      } finally {
        await ctx.admin.from("trip_members")
          .update({ role: "Member" }).eq("trip_id", tripId).eq("user_id", memberId);
      }
    });

    it("tripMembers.remove REFUSES an Organizer removing the Owner", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.remove({ tripId, userId: ctx.user.id })
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // THE INVITE PAIR — moved on the THIRD attempt (#788 → reverted #790 →
  // #823 → reverted → here). Both of the reasons behind those reverts are
  // resolved: the role-INPUT split is back (below, plus migration 103 at the
  // DB), and migration 122 widened the `trip_members` policies that refused
  // the writes in CI last time.
  //
  // The distinction this pair exists to hold: an Organizer may INVITE, but may
  // not invite someone AS AN ORGANIZER. A procedure that takes a role as input
  // cannot be gated on role alone.
  // =========================================================================
  describe("the invite pair — moved (migration 122)", () => {
    it("inviteByEmail admits an Organizer inviting a MEMBER", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.inviteByEmail({
            tripId,
            email: `invite-member-${genId("e")}@example.test`,
            role: "Member",
          })
        )
      ).toBe(false);
    });

    it("inviteByEmail REFUSES an Organizer inviting an ORGANIZER", async () => {
      // The whole reason #790 reverted this. The guard admits the caller; the
      // procedure refuses the grant.
      expect(
        await forbidden(() =>
          ctx.callerAs("planner").tripMembers.inviteByEmail({
            tripId,
            email: `invite-organizer-${genId("e")}@example.test`,
            role: "Organizer",
          })
        )
      ).toBe(true);
    });

    it("inviteByEmail still admits the OWNER inviting an Organizer", async () => {
      expect(
        await forbidden(() =>
          ctx.caller().tripMembers.inviteByEmail({
            tripId,
            email: `owner-invite-org-${genId("e")}@example.test`,
            role: "Organizer",
          })
        )
      ).toBe(false);
    });

    it("inviteByEmail refuses a Member", async () => {
      expect(
        await forbidden(() =>
          ctx.callerAs("member").tripMembers.inviteByEmail({
            tripId,
            email: `member-invite-${genId("e")}@example.test`,
            role: "Member",
          })
        )
      ).toBe(true);
    });

    it("sendInvitationBlast admits an Organizer (it grants no role)", async () => {
      expect(
        await forbidden(() =>
          ctx
            .callerAs("planner")
            .tripMembers.sendInvitationBlast({ tripId, memberUserIds: [memberId] })
        )
      ).toBe(false);
    });

    it("sendInvitationBlast refuses a Member", async () => {
      expect(
        await forbidden(() =>
          ctx
            .callerAs("member")
            .tripMembers.sendInvitationBlast({ tripId, memberUserIds: [memberId] })
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
