import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 101 — Organizer parity at the RLS layer (#786).
 *
 * Tests every POLICY the migration changes DIRECTLY, through each role's own
 * authenticated client, so the migration PR is verifiable on its own without
 * the tRPC guard change that follows it. Enumerated, not sampled: one
 * Organizer-allowed and one Member-refused case per policy.
 *
 * Three things this file is also here to PIN, which are easy to lose later:
 *
 *  1. The `trip_members` policies were deliberately NOT widened (they can't be
 *     without a role-column trigger — see the migration's closing note). The
 *     "still refused" block below fails if someone widens them without it.
 *  2. The sanctioned Owner-only exceptions stay Owner-only at the DB layer.
 *  3. `assert_game_owner` is a plpgsql gate, not a policy — invisible to any
 *     pg_policies sweep — so it is exercised through the RPC wrappers that
 *     call it, which is the only way a caller ever reaches it.
 *
 * "planner" is the shared test user holding the trip role `Organizer` (the
 * fixture name predates migration 029's rename).
 */
describe("migration 101 — Organizer parity RLS", () => {
  let ctx: TestContext;
  let tripId: string;
  let competitionId: string;
  let teamId: string;
  let windowId: string;
  let guestId: string;
  let organizerId: string;
  let memberId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Organizer Parity Trip");
    // Sequential, never Promise.all — these race (CLAUDE.md, learned ~6x).
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    organizerId = ctx.getUser("planner").id;
    memberId = ctx.getUser("member").id;

    competitionId = await ctx.createCompetition(tripId, "Parity Cup");
    teamId = await ctx.createTeam(competitionId, "Parity Team");

    windowId = genId("dw");
    await ctx.admin.from("date_windows").insert({
      id: windowId,
      trip_id: tripId,
      start_date: "2027-05-01",
      end_date: "2027-05-04",
    });

    // A placeholder crew member, for the date_poll_votes "_ghost" policies.
    guestId = genId("guest");
    await ctx.admin
      .from("users")
      .insert({ id: guestId, name: "Parity Guest", is_guest: true });
    await ctx.admin
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: guestId, role: "Member", status: "in" });
  });

  afterAll(async () => {
    await ctx.admin.from("date_poll_votes").delete().eq("window_id", windowId);
    await ctx.admin.from("date_windows").delete().eq("id", windowId);
    await ctx.admin.from("invites").delete().eq("trip_id", tripId);
    await ctx.admin.from("ideas").delete().eq("trip_id", tripId);
    await ctx.admin.from("trip_members").delete().eq("user_id", guestId);
    await ctx.admin.from("users").delete().eq("id", guestId);
    await ctx.cleanup();
  });

  // -------------------------------------------------------------------------
  // 1. invites INSERT  <-  tripMembers.inviteByEmail / .sendInvitationBlast
  // -------------------------------------------------------------------------
  it("invites: an Organizer CAN create an invite", async () => {
    const { error } = await ctx.authedClient("planner").from("invites").insert({
      trip_id: tripId,
      email: `parity-org-${genId("e")}@example.test`,
      role: "Member",
      created_by: organizerId,
    });
    expect(error).toBeNull();
  });

  it("invites: a Member CANNOT create an invite", async () => {
    const { error } = await ctx.authedClient("member").from("invites").insert({
      trip_id: tripId,
      email: `parity-mem-${genId("e")}@example.test`,
      role: "Member",
      created_by: memberId,
    });
    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. ideas INSERT / DELETE  <-  ideas.create / ideas.remove
  // -------------------------------------------------------------------------
  it("ideas: an Organizer CAN create an idea", async () => {
    const { error } = await ctx.authedClient("planner").from("ideas").insert({
      id: genId("idea"),
      trip_id: tripId,
      title: "Organizer's idea",
      location: "Somewhere",
    });
    expect(error).toBeNull();
  });

  it("ideas: a Member CANNOT create an idea", async () => {
    const { error } = await ctx.authedClient("member").from("ideas").insert({
      id: genId("idea"),
      trip_id: tripId,
      title: "Member's idea",
      location: "Somewhere",
    });
    expect(error).not.toBeNull();
  });

  it("ideas: an Organizer CAN delete an idea", async () => {
    const id = genId("idea");
    await ctx.admin
      .from("ideas")
      .insert({ id, trip_id: tripId, title: "Doomed", location: "X" });

    await ctx.authedClient("planner").from("ideas").delete().eq("id", id);

    const { data } = await ctx.admin.from("ideas").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
  });

  it("ideas: a Member CANNOT delete an idea", async () => {
    const id = genId("idea");
    await ctx.admin
      .from("ideas")
      .insert({ id, trip_id: tripId, title: "Survivor", location: "X" });

    await ctx.authedClient("member").from("ideas").delete().eq("id", id);

    // RLS scopes the DELETE to zero rows — no error, the row simply survives.
    const { data } = await ctx.admin.from("ideas").select("id").eq("id", id);
    expect(data?.map((r) => r.id)).toContain(id);
  });

  // -------------------------------------------------------------------------
  // 3. team_assignments DELETE  <-  teamAssignments.remove
  // -------------------------------------------------------------------------
  async function seedAssignment(userId: string) {
    await ctx.admin
      .from("team_assignments")
      .upsert({ competition_id: competitionId, user_id: userId, team_id: teamId });
  }
  async function assignmentExists(userId: string) {
    const { data } = await ctx.admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", competitionId)
      .eq("user_id", userId);
    return (data ?? []).length > 0;
  }

  it("team_assignments: an Organizer CAN un-assign a player", async () => {
    await seedAssignment(memberId);
    await ctx
      .authedClient("planner")
      .from("team_assignments")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", memberId);
    expect(await assignmentExists(memberId)).toBe(false);
  });

  it("team_assignments: a Member CANNOT un-assign a player", async () => {
    await seedAssignment(memberId);
    await ctx
      .authedClient("member")
      .from("team_assignments")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", memberId);
    expect(await assignmentExists(memberId)).toBe(true);
    await ctx.admin
      .from("team_assignments")
      .delete()
      .eq("competition_id", competitionId)
      .eq("user_id", memberId);
  });

  // -------------------------------------------------------------------------
  // 4. date_poll_votes x4  <-  datePoll.castVoteForMember
  //    "_ghost" pair = voting for a placeholder; "_owner_any" pair = voting for
  //    a real member. All four move together (see the migration note).
  // -------------------------------------------------------------------------
  beforeEach(async () => {
    await ctx.admin.from("date_poll_votes").delete().eq("window_id", windowId);
  });

  it("date_poll_votes (_insert_ghost): an Organizer CAN vote for a placeholder", async () => {
    const { error } = await ctx.authedClient("planner").from("date_poll_votes").insert({
      window_id: windowId,
      user_id: guestId,
      answer: "yes",
    });
    expect(error).toBeNull();
  });

  it("date_poll_votes (_insert_ghost): a Member CANNOT vote for a placeholder", async () => {
    const { error } = await ctx.authedClient("member").from("date_poll_votes").insert({
      window_id: windowId,
      user_id: guestId,
      answer: "yes",
    });
    expect(error).not.toBeNull();
  });

  it("date_poll_votes (_update_ghost): an Organizer CAN change a placeholder's vote", async () => {
    await ctx.admin
      .from("date_poll_votes")
      .insert({ window_id: windowId, user_id: guestId, answer: "no" });

    await ctx
      .authedClient("planner")
      .from("date_poll_votes")
      .update({ answer: "yes" })
      .eq("window_id", windowId)
      .eq("user_id", guestId);

    const { data } = await ctx.admin
      .from("date_poll_votes")
      .select("answer")
      .eq("window_id", windowId)
      .eq("user_id", guestId)
      .single();
    expect(data?.answer).toBe("yes");
  });

  it("date_poll_votes (_update_ghost): a Member CANNOT change a placeholder's vote", async () => {
    await ctx.admin
      .from("date_poll_votes")
      .insert({ window_id: windowId, user_id: guestId, answer: "no" });

    await ctx
      .authedClient("member")
      .from("date_poll_votes")
      .update({ answer: "yes" })
      .eq("window_id", windowId)
      .eq("user_id", guestId);

    const { data } = await ctx.admin
      .from("date_poll_votes")
      .select("answer")
      .eq("window_id", windowId)
      .eq("user_id", guestId)
      .single();
    expect(data?.answer).toBe("no");
  });

  it("date_poll_votes (_insert_owner_any): an Organizer CAN vote for a real member", async () => {
    const { error } = await ctx.authedClient("planner").from("date_poll_votes").insert({
      window_id: windowId,
      user_id: memberId,
      answer: "maybe",
    });
    expect(error).toBeNull();
  });

  it("date_poll_votes (_insert_owner_any): a Member CANNOT vote for another member", async () => {
    // The member votes for the ORGANIZER — not themselves, so the self-vote
    // policy doesn't apply and only the widened policy could admit it.
    const { error } = await ctx.authedClient("member").from("date_poll_votes").insert({
      window_id: windowId,
      user_id: organizerId,
      answer: "maybe",
    });
    expect(error).not.toBeNull();
  });

  it("date_poll_votes (_update_owner_any): an Organizer CAN change a real member's vote", async () => {
    await ctx.admin
      .from("date_poll_votes")
      .insert({ window_id: windowId, user_id: memberId, answer: "no" });

    await ctx
      .authedClient("planner")
      .from("date_poll_votes")
      .update({ answer: "yes" })
      .eq("window_id", windowId)
      .eq("user_id", memberId);

    const { data } = await ctx.admin
      .from("date_poll_votes")
      .select("answer")
      .eq("window_id", windowId)
      .eq("user_id", memberId)
      .single();
    expect(data?.answer).toBe("yes");
  });

  it("date_poll_votes (_update_owner_any): a Member CANNOT change another member's vote", async () => {
    await ctx.admin
      .from("date_poll_votes")
      .insert({ window_id: windowId, user_id: organizerId, answer: "no" });

    await ctx
      .authedClient("member")
      .from("date_poll_votes")
      .update({ answer: "yes" })
      .eq("window_id", windowId)
      .eq("user_id", organizerId);

    const { data } = await ctx.admin
      .from("date_poll_votes")
      .select("answer")
      .eq("window_id", windowId)
      .eq("user_id", organizerId)
      .single();
    expect(data?.answer).toBe("no");
  });

  // -------------------------------------------------------------------------
  // 5. assert_game_owner()  <-  games.resetScoring / .resetToSkeleton
  //    A plpgsql gate, not a policy: reached only through the RPC wrappers.
  // -------------------------------------------------------------------------
  describe("assert_game_owner (the third gate)", () => {
    let gameId: string;

    beforeEach(async () => {
      gameId = genId("parity-game");
      await ctx.admin.from("games").insert({
        id: gameId,
        trip_id: tripId,
        competition_id: competitionId,
        game_type_id: "gtt_match_play",
        name: "Parity Game",
        status: "complete",
        scoring_enabled: true,
      });
      await ctx.admin.from("score_entries").insert({
        id: genId("se"),
        game_id: gameId,
        participant_id: memberId,
        participant_type: "user",
        unit_label: "1",
        value: 4,
      });
    });

    async function scoreCount() {
      const { count } = await ctx.admin
        .from("score_entries")
        .select("id", { count: "exact", head: true })
        .eq("game_id", gameId);
      return count ?? 0;
    }

    it("an Organizer CAN reset a game's scoring", async () => {
      const { error } = await ctx
        .authedClient("planner")
        .rpc("reset_game_scoring", { p_game_id: gameId });
      expect(error).toBeNull();
      expect(await scoreCount()).toBe(0);
    });

    it("an Organizer CAN reset a game to skeleton", async () => {
      const { error } = await ctx
        .authedClient("planner")
        .rpc("reset_game_to_skeleton", { p_game_id: gameId });
      expect(error).toBeNull();
      expect(await scoreCount()).toBe(0);
    });

    it("a Member CANNOT reset a game's scoring", async () => {
      const { error } = await ctx
        .authedClient("member")
        .rpc("reset_game_scoring", { p_game_id: gameId });
      expect(error).not.toBeNull();
      expect(await scoreCount()).toBe(1);
    });

    it("an outsider CANNOT reset a game's scoring", async () => {
      const { error } = await ctx
        .authedClient("outsider")
        .rpc("reset_game_to_skeleton", { p_game_id: gameId });
      expect(error).not.toBeNull();
      expect(await scoreCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. STILL REFUSED — the boundaries this migration deliberately does not move
  // -------------------------------------------------------------------------
  describe("still Owner-only after this migration", () => {
    it("trip_members: an Organizer still CANNOT add someone to the roster", async () => {
      // Held back on purpose: widening trip_members_insert without a
      // role-column trigger would let an Organizer insert an 'Owner' row.
      const { error } = await ctx.authedClient("planner").from("trip_members").insert({
        trip_id: tripId,
        user_id: guestId,
        role: "Member",
        status: "in",
      });
      expect(error).not.toBeNull();
    });

    it("trip_members: an Organizer still CANNOT change another member's role", async () => {
      // The case that makes the trigger a prerequisite: if this ever passes,
      // exception 1 (only the Owner changes who is trusted) holds only in the
      // client. Self-elevation is the same write with user_id = the caller.
      await ctx
        .authedClient("planner")
        .from("trip_members")
        .update({ role: "Owner" })
        .eq("trip_id", tripId)
        .eq("user_id", memberId);

      const { data } = await ctx.admin
        .from("trip_members")
        .select("role")
        .eq("trip_id", tripId)
        .eq("user_id", memberId)
        .single();
      expect(data?.role).toBe("Member");
    });

    it("trips: an Organizer still CANNOT delete the trip (exception 2)", async () => {
      await ctx.authedClient("planner").from("trips").delete().eq("id", tripId);
      const { data } = await ctx.admin.from("trips").select("id").eq("id", tripId);
      expect(data?.map((r) => r.id)).toContain(tripId);
    });

    it("competitions: an Organizer still CANNOT delete the competition (exception 4)", async () => {
      await ctx
        .authedClient("planner")
        .from("competitions")
        .delete()
        .eq("id", competitionId);
      const { data } = await ctx.admin
        .from("competitions")
        .select("id")
        .eq("id", competitionId);
      expect(data?.map((r) => r.id)).toContain(competitionId);
    });
  });
});
