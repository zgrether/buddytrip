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
    await ctx.addTripMember(tripId, "planner", "Planner");
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

  // add
  it("add — planner can add a member", async () => {
    const outsider = ctx.getUser("outsider");
    const caller = ctx.callerAs("planner");
    const added = await caller.tripMembers.add({
      tripId,
      userId: outsider.id,
    });
    expect(added.user_id).toBe(outsider.id);
    expect(added.role).toBe("Member");
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
    const caller = ctx.callerAs("planner");
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
      role: "Planner",
    });
    expect(updated.role).toBe("Planner");
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
      caller.tripMembers.updateRole({ tripId, userId: member.id, role: "Planner" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // inviteByEmail
  it("inviteByEmail — planner can invite a new email", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.tripMembers.inviteByEmail({
      tripId,
      email: "newperson@example.com",
    });
    expect(result.status).toBe("invited_new");
    expect(result.userId).toBeTruthy();
  });

  it("inviteByEmail — duplicate invite returns already_member", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.tripMembers.inviteByEmail({
      tripId,
      email: "newperson@example.com",
    });
    expect(result.status).toBe("already_member");
  });

  it("inviteByEmail — existing real user gets added directly", async () => {
    // Use a fresh trip so outsider isn't already a member
    const freshTripId = await ctx.createTrip("Invite Fresh Trip");
    await ctx.addTripMember(freshTripId, "planner", "Planner");
    const caller = ctx.callerAs("planner");
    const outsider = ctx.getUser("outsider");
    const result = await caller.tripMembers.inviteByEmail({
      tripId: freshTripId,
      email: outsider.email,
    });
    expect(result.status).toBe("added_existing");
  });

  it("inviteByEmail — member cannot invite", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.inviteByEmail({ tripId, email: "another@example.com" })
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
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");

    // Set destination + advance through stages
    const admin = ctx.admin;
    await admin.from("trips").update({
      locked_destination_title: "Test Dest",
      locked_destination_location: "Test, TX",
    }).eq("id", tripId);
    await admin.from("trips").update({ stage: "planning" }).eq("id", tripId);
    await admin.from("trips").update({
      stage: "going",
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
});

// ── sendInvitationBlast tests ────────────────────────────────────────────────

describe("tripMembers router — sendInvitationBlast", () => {
  let ctx: TestContext;
  let tripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Blast Test Trip");
    await ctx.addTripMember(tripId, "planner", "Planner");
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

  it("sendInvitationBlast — updates last_blast_sent_at on the trip", async () => {
    const admin = ctx.admin;
    const caller = ctx.caller();
    const planner = ctx.getUser("planner");

    await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [planner.id],
    });

    const { data: trip } = await admin
      .from("trips")
      .select("last_blast_sent_at")
      .eq("id", tripId)
      .single();

    expect(trip?.last_blast_sent_at).toBeTruthy();
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
});
