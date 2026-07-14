import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { sendInvitationBlast } from "@/lib/email";

vi.mock("@/lib/email", () => ({
  sendInvitationBlast: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendInviteExistingUser: vi.fn().mockResolvedValue({}),
  sendInviteNewUser: vi.fn().mockResolvedValue({}),
}));

let ctx: TestContext;
let tripId: string;

describe("tripMembers router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Members Test Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  // list
  it("list — any member can view crew roster", async () => {
    const caller = ctx.callerAs("member");
    const members = await caller.tripMembers.list({ tripId });
    expect(members.length).toBe(3);
    expect(members[0].user).toBeTruthy();
  });

  // add — Owner-only (Task 53 hardening: roster management is Owner-only).
  it("add — owner can add a member", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.caller();
    const added = await caller.tripMembers.add({
      tripId,
      userId: outsider.id,
    });
    expect(added.user_id).toBe(outsider.id);
    expect(added.role).toBe("Member");
  });

  it("add — planner cannot add (Owner only)", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.add({ tripId, userId: genId("fake-user") })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("add — member cannot add", async () => {
    const caller = ctx.callerAs("member");
    // Use a random UUID — the FORBIDDEN check fires before user lookup
    await expect(
      caller.tripMembers.add({ tripId, userId: genId("fake-user") })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("add — duplicate throws CONFLICT", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.caller();
    await expect(
      caller.tripMembers.add({ tripId, userId: outsider.id })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // updateRole
  it("updateRole — owner can promote member to planner", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.caller();
    const updated = await caller.tripMembers.updateRole({
      tripId,
      userId: outsider.id,
      role: "Organizer",
    });
    expect(updated.role).toBe("Organizer");
  });

  it("updateRole — promotion posts a system line in the Organizers chat", async () => {
    // Regression: the messages_insert RLS policy only allows a member to insert
    // their own message_type='user' rows, so system lines (user_id=null,
    // message_type='system') must go through the service-role admin client.
    // This proves the promotion announcement actually lands in the channel.
    const freshTrip = await ctx.createTrip("Promote Announce Trip");
    await ctx.addTripMember(freshTrip, "member", "Member");
    const owner = ctx.caller();

    await owner.tripMembers.updateRole({
      tripId: freshTrip,
      userId: ctx.getUser("member").id,
      role: "Organizer",
    });

    const planning = await owner.messages.list({
      tripId: freshTrip,
      visibility: "planning",
    });
    expect(
      planning.some(
        (m) => m.message_type === "system" && /is now an organizer/.test(m.text)
      )
    ).toBe(true);
  });

  it("updateRole — owner cannot change own role", async () => {
    const caller = ctx.caller();
    await expect(
      caller.tripMembers.updateRole({ tripId, userId: ctx.user.id, role: "Member" })
    ).rejects.toThrow("Cannot change your own role");
  });

  it("updateRole — planner cannot change roles", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.updateRole({ tripId, userId: member.id, role: "Organizer" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // inviteByEmail — Owner-only (Task 53 hardening).
  it("inviteByEmail — owner can invite a new email", async () => {
    const caller = ctx.caller();
    const result = await caller.tripMembers.inviteByEmail({
      tripId,
      email: "newperson@example.com",
    });
    expect(result.status).toBe("invited_new");
    expect(result.userId).toBeTruthy();
  });

  it("inviteByEmail — duplicate invite returns already_member", async () => {
    const caller = ctx.caller();
    const result = await caller.tripMembers.inviteByEmail({
      tripId,
      email: "newperson@example.com",
    });
    expect(result.status).toBe("already_member");
  });

  it("inviteByEmail — existing real user gets added directly", async () => {
    // Use a fresh trip so outsider isn't already a member
    const freshTripId = await ctx.createTrip("Invite Fresh Trip");
    await ctx.addTripMember(freshTripId, "planner", "Organizer");
    const caller = ctx.caller();
    const outsider = ctx.getUser("outsider");
    const result = await caller.tripMembers.inviteByEmail({
      tripId: freshTripId,
      email: outsider.email,
    });
    expect(result.status).toBe("added_existing");
  });

  it("inviteByEmail — planner cannot invite (Owner only)", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.inviteByEmail({ tripId, email: "another@example.com" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("inviteByEmail — member cannot invite", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.inviteByEmail({ tripId, email: "another@example.com" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // updateNickname — trip-scoped display-name override (Task 47).
  //
  // The earlier MemberEditor only fired ghostCrew.update when the row was a
  // guest, so renames for real-account members silently dropped. This
  // mutation lives on trip_members so it works for everyone. As of Task 53
  // it's Owner-only — the Owner row is also locked so an Owner can't rename
  // themselves through the trip context (they use account settings).
  it("updateNickname — owner can rename a member", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const result = await caller.tripMembers.updateNickname({
      tripId,
      userId: member.id,
      nickname: "Buddy",
    });
    expect(result.success).toBe(true);
    expect(result.nickname).toBe("Buddy");

    // listMembers now surfaces the override as displayName so the rail and
    // edit drawer pick it up without extra plumbing.
    const list = await caller.tripMembers.list({ tripId });
    const row = list.find((m) => m.user_id === member.id);
    expect(row?.nickname).toBe("Buddy");
    expect(row?.displayName).toBe("Buddy");
  });

  it("updateNickname — empty string clears the override", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const result = await caller.tripMembers.updateNickname({
      tripId,
      userId: member.id,
      nickname: "   ",
    });
    // Whitespace-only collapses to null so display falls back to users.name.
    expect(result.nickname).toBeNull();
  });

  it("updateNickname — Owner row is locked", async () => {
    // The Owner-row guard is checked even for Owner callers, so this
    // verifies the guard rather than the role middleware.
    const caller = ctx.caller();
    await expect(
      caller.tripMembers.updateNickname({
        tripId,
        userId: ctx.user.id,
        nickname: "Boss",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updateNickname — planner cannot rename (Owner only)", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.updateNickname({
        tripId,
        userId: member.id,
        nickname: "Nope",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updateNickname — plain member cannot rename others", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.updateNickname({
        tripId,
        userId: member.id,
        nickname: "Mine",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // remove
  it("remove — owner cannot remove self", async () => {
    const caller = ctx.caller();
    await expect(
      caller.tripMembers.remove({ tripId, userId: ctx.user.id })
    ).rejects.toThrow("Cannot remove yourself");
  });

  it("remove — owner can remove a member", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.caller();
    const result = await caller.tripMembers.remove({ tripId, userId: outsider.id });
    expect(result.success).toBe(true);
  });
});

// ── Travel tests ─────────────────────────────────────────────────────────

describe("tripMembers router — travel", () => {
  let ctx: TestContext;
  let tripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    // Create trip and advance to going stage so travel fields are in play
    tripId = await ctx.createTrip("Travel Test Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");

    // Lock a destination (moves the trip out of the idea phase) + set an
    // about message.
    const admin = ctx.admin;
    await admin.from("trips").update({
      locked_destination_title: "Test Dest",
      locked_destination_location: "Test, TX",
      locked_destination_at: new Date().toISOString(),
      about_message: "Let's go!",
    }).eq("id", tripId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("updateTravel — member can update own travel (flying)", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.tripMembers.updateTravel({
      tripId,
      travelMode: "flying",
      flightAirline: "Delta",
      flightNumber: "DL1733",
      flightArrivalTime: "2026-10-05T19:33:00Z",
      flightAirport: "JAX",
      travelShared: true,
    });
    expect(result.travel_mode).toBe("flying");
    expect(result.flight_airline).toBe("Delta");
    expect(result.flight_number).toBe("DL1733");
    expect(result.travel_shared).toBe(true);
  });

  it("updateTravel — member can update own travel (driving)", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.tripMembers.updateTravel({
      tripId,
      travelMode: "driving",
      travelDetail: "Renting a car from Enterprise",
      travelShared: false,
    });
    expect(result.travel_mode).toBe("driving");
    expect(result.travel_detail).toBe("Renting a car from Enterprise");
    expect(result.travel_shared).toBe(false);
  });

  it("updateTravel — member can clear travel mode", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.tripMembers.updateTravel({
      tripId,
      travelMode: null,
      travelShared: false,
    });
    expect(result.travel_mode).toBeNull();
  });

  it("updateTravel — member can enter a departure leg (date/time/mode/details)", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.tripMembers.updateTravel({
      tripId,
      travelMode: "flying",
      travelDetail: "Landing Thu",
      flightArrivalTime: "2026-09-09T15:30:00Z",
      departureMode: "driving",
      departureDetail: "Heading out Sunday — carpool with Sam",
      departureTime: "2026-09-13T11:00:00Z",
      travelShared: true,
    });
    expect(result.travel_mode).toBe("flying");
    expect(result.departure_mode).toBe("driving");
    expect(result.departure_detail).toBe("Heading out Sunday — carpool with Sam");
    // timestamptz round-trips as an ISO string carrying the stored instant.
    expect(result.departure_time).toContain("2026-09-13");
  });

  it("updateTravel — departure leg is independent of the arrival leg", async () => {
    const caller = ctx.callerAs("member");
    // Clear arrival but keep departure fields untouched (omit them) — they must
    // not be wiped by an arrival-only update.
    const result = await caller.tripMembers.updateTravel({
      tripId,
      travelMode: null,
      travelShared: false,
    });
    expect(result.travel_mode).toBeNull();
    // departure_* untouched (still set from the prior test).
    expect(result.departure_mode).toBe("driving");
  });

  it("updateMemberTravel — owner can enter a departure leg for a member", async () => {
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const result = await caller.tripMembers.updateMemberTravel({
      tripId,
      targetUserId: member.id,
      travelMode: "flying",
      departureMode: "flying",
      departureDetail: "Red-eye home",
      departureTime: "2026-09-13T22:15:00Z",
    });
    expect(result.success).toBe(true);

    const list = await caller.tripMembers.list({ tripId });
    const row = list.find((m) => m.user_id === member.id);
    expect(row?.departure_mode).toBe("flying");
    expect(row?.departure_detail).toBe("Red-eye home");
  });
});

// ── sendInvitationBlast tests ────────────────────────────────────────────────

describe("tripMembers router — sendInvitationBlast", () => {
  let ctx: TestContext;
  let tripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Blast Test Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("sendInvitationBlast — owner can blast to members with email", async () => {
    vi.mocked(sendInvitationBlast).mockClear();
    const caller = ctx.caller();
    const planner = ctx.getUser("planner");
    const member = ctx.getUser("member");

    const result = await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [planner.id, member.id],
    });

    expect(result.sent).toBeGreaterThan(0);
    expect(vi.mocked(sendInvitationBlast)).toHaveBeenCalled();
  });

  it("sendInvitationBlast — sends the explicit message body verbatim", async () => {
    vi.mocked(sendInvitationBlast).mockClear();
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const body = "Hey! I'm starting to plan a trip and could use your help.";

    await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [member.id],
      message: body,
    });

    expect(vi.mocked(sendInvitationBlast)).toHaveBeenCalledWith(
      expect.objectContaining({ invitationMessage: body })
    );
  });

  it("sendInvitationBlast — stamps last_emailed_at and bumps email_count", async () => {
    const admin = ctx.admin;
    const caller = ctx.caller();
    const member = ctx.getUser("member");

    // Read the starting count so we assert a real increment regardless of
    // how many prior blast tests already touched this member.
    const { data: before } = await admin
      .from("trip_members")
      .select("email_count")
      .eq("trip_id", tripId)
      .eq("user_id", member.id)
      .single();
    const startCount = before?.email_count ?? 0;

    await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [member.id],
    });

    const { data: after } = await admin
      .from("trip_members")
      .select("last_emailed_at, email_count")
      .eq("trip_id", tripId)
      .eq("user_id", member.id)
      .single();

    expect(after?.last_emailed_at).toBeTruthy();
    expect(after?.email_count).toBe(startCount + 1);
  });

  it("sendInvitationBlast — member cannot blast", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.sendInvitationBlast({
        tripId,
        memberUserIds: [ctx.getUser("planner").id],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sendInvitationBlast — planner cannot blast (owner-only)", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.sendInvitationBlast({
        tripId,
        memberUserIds: [ctx.getUser("member").id],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
