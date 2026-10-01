import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE TRIP IT USES (#1527). This file used to thread one trip
 * through two dozen cases: two "tests" were setup (add the crew, lock the
 * destination), later cases relied on earlier renames and locks, and the
 * ownership-transfer case transferred BACK at the end "so subsequent tests work".
 * A failure anywhere failed everything after it as if behaviour broke, and the
 * refusal cases could pass against a trip that was never set up. Shuffled test
 * order surfaced 17 such dependencies here.
 *
 * So each case starts from `crewTrip()` (or creates its own) and, where it tests
 * a refusal or an absence, first asserts that the thing it is about EXISTS — a
 * FORBIDDEN on a missing trip, or an absence in an empty list, proves nothing.
 */

/** Owner = the primary user; planner = Organizer; member = Member; destination locked. */
async function crewTrip(ctx: TestContext, title: string): Promise<string> {
  const tripId = await ctx.createTrip(title);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  // Members only see a trip once a destination is locked (RLS: an idea-phase
  // trip is planner-only).
  const { error } = await ctx.admin
    .from("trips")
    .update({ locked_destination_title: "Test Dest", locked_destination_at: new Date().toISOString() })
    .eq("id", tripId);
  if (error) throw new Error(`lock destination: ${error.message}`);
  return tripId;
}

/** The trip row, or null if it does not exist. A failed READ throws: a helper
 *  that returned null on an error would make "the trip is gone" indistinguishable
 *  from "the query failed", the exact confusion this file is being rewritten to end. */
async function tripRow(ctx: TestContext, tripId: string) {
  const { data, error } = await ctx.admin.from("trips").select("id, title").eq("id", tripId).maybeSingle();
  if (error) throw new Error(`read trip ${tripId}: ${error.message}`);
  return data as { id: string; title: string } | null;
}

async function roleOf(ctx: TestContext, tripId: string, userId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("trip_members")
    .select("role")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`read role: ${error.message}`);
  return (data?.role as string | undefined) ?? null;
}

describe("trips router", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — any user can create a trip and becomes Owner", async () => {
    const id = `test-trip-${Date.now()}`;
    const trip = await ctx.caller().trips.create({ id, title: "Test Trip", description: "A test trip" });
    ctx.trackTrip(id);
    expect(trip.title).toBe("Test Trip");

    const { data: memberRow } = await ctx.admin
      .from("trip_members")
      .select("role, status")
      .eq("trip_id", id)
      .eq("user_id", ctx.user.id)
      .single();
    expect(memberRow?.role).toBe("Owner");
    expect(memberRow?.status).toBe("in");
  });

  it("list — returns trips for the current user", async () => {
    const tripId = await crewTrip(ctx, "List Mine");
    const trips = await ctx.caller().trips.list();
    expect(trips.some((t: { id: string }) => t.id === tripId)).toBe(true);
  });

  it("list — an outsider does not see the trip (the owner does)", async () => {
    const tripId = await crewTrip(ctx, "List Outsider");
    // CONTROL: the trip exists and is listed for someone on it, so its absence
    // from the outsider's list is the filter, not an empty table.
    const mine = await ctx.caller().trips.list();
    expect(mine.some((t: { id: string }) => t.id === tripId)).toBe(true);
    const theirs = await ctx.callerAs("outsider").trips.list();
    expect(theirs.some((t: { id: string }) => t.id === tripId)).toBe(false);
  });

  it("getById — member can view trip", async () => {
    const tripId = await crewTrip(ctx, "Get Member");
    const trip = await ctx.callerAs("member").trips.getById({ tripId });
    expect(trip.id).toBe(tripId);
  });

  it("getById — outsider is FORBIDDEN from a trip that exists", async () => {
    const tripId = await crewTrip(ctx, "Get Outsider");
    expect(await tripRow(ctx, tripId)).not.toBeNull();
    await expect(ctx.callerAs("outsider").trips.getById({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lockDestination — owner can lock", async () => {
    const tripId = await crewTrip(ctx, "Lock Owner");
    const trip = await ctx.caller().trips.lockDestination({ tripId, title: "Pebble Beach", location: "Monterey, CA" });
    expect(trip.locked_destination_title).toBe("Pebble Beach");
    expect(trip.comparison_mode).toBe(false);
  });

  // Reversed by #786: choosing the destination is trip-running, not trip
  // administration. transferOwnership (below) is what stays Owner-only.
  it("lockDestination — planner (Organizer) CAN lock", async () => {
    const tripId = await crewTrip(ctx, "Lock Organizer");
    const trip = await ctx.callerAs("planner").trips.lockDestination({ tripId, title: "Somewhere", location: "Nowhere" });
    expect(trip.locked_destination_title).toBe("Somewhere");
  });

  it("create — Choice A: creates trip with locked destination", async () => {
    const id = `test-trip-known-${Date.now()}`;
    const trip = await ctx.caller().trips.create({
      id,
      title: "Known Dest Trip",
      comparisonMode: false,
      lockedDestination: { title: "Bandon Dunes", location: "Bandon Dunes, OR" },
    });
    ctx.trackTrip(id);
    expect(trip.comparison_mode).toBe(false);
    expect(trip.locked_destination_title).toBe("Bandon Dunes");
    expect(trip.locked_destination_location).toBe("Bandon Dunes, OR");
    expect(trip.locked_destination_at).toBeTruthy();
  });

  it("create — Choice B: creates trip with comparisonMode and seeded ideas", async () => {
    const id = `test-trip-vote-${Date.now()}`;
    const trip = await ctx.caller().trips.create({
      id,
      title: "Vote Trip",
      comparisonMode: true,
      ideas: [
        { id: `idea-1-${Date.now()}`, title: "Scottsdale", location: "Scottsdale, AZ", source: "manual" },
        { id: `idea-2-${Date.now()}`, title: "Cabo", location: "Cabo San Lucas, MX", description: "Great beach vibes", costTier: "$$$", source: "ai" },
      ],
    });
    ctx.trackTrip(id);
    expect(trip.comparison_mode).toBe(true);
    expect(trip.locked_destination_title).toBeNull();

    const { data: ideas } = await ctx.admin
      .from("ideas")
      .select("title, source")
      .eq("trip_id", id)
      .order("created_at", { ascending: true });
    expect(ideas).toHaveLength(2);
    expect(ideas![0].title).toBe("Scottsdale");
    expect(ideas![0].source).toBe("manual");
    expect(ideas![1].title).toBe("Cabo");
    expect(ideas![1].source).toBe("ai");
  });

  it("create — co-planners are added as trip members", async () => {
    const id = `test-trip-coplan-${Date.now()}`;
    const planner = ctx.getUser("planner");
    const trip = await ctx.caller().trips.create({
      id,
      title: "Coplanners Trip",
      coplanners: [{ userId: planner.id, role: "Organizer" }],
    });
    ctx.trackTrip(id);
    expect(trip.title).toBe("Coplanners Trip");
    expect(await roleOf(ctx, id, planner.id)).toBe("Organizer");
  });

  it("renameTripName — owner can rename", async () => {
    const tripId = await crewTrip(ctx, "Rename Owner");
    const result = await ctx.caller().trips.renameTripName({ tripId, name: "Renamed Trip" });
    expect(result.name).toBe("Renamed Trip");
  });

  it("renameTripName — planner can rename", async () => {
    const tripId = await crewTrip(ctx, "Rename Organizer");
    const result = await ctx.callerAs("planner").trips.renameTripName({ tripId, name: "Organizer Renamed" });
    expect(result.name).toBe("Organizer Renamed");
  });

  it("renameTripName — member cannot rename, and the name is unchanged", async () => {
    const tripId = await crewTrip(ctx, "Rename Member");
    const before = await tripRow(ctx, tripId);
    expect(before).not.toBeNull();
    await expect(
      ctx.callerAs("member").trips.renameTripName({ tripId, name: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await tripRow(ctx, tripId))?.title).toBe(before!.title);
  });

  it("transferOwnership — owner can transfer to member, and the roles swap", async () => {
    const tripId = await crewTrip(ctx, "Transfer Member");
    const member = ctx.getUser("member");
    const result = await ctx.caller().trips.transferOwnership({ tripId, newOwnerId: member.id });
    expect(result.success).toBe(true);
    expect(await roleOf(ctx, tripId, ctx.user.id)).toBe("Organizer");
    expect(await roleOf(ctx, tripId, member.id)).toBe("Owner");
    // No transfer back: this trip is this test's alone.
  });

  it("transferOwnership — cannot transfer to self", async () => {
    const tripId = await crewTrip(ctx, "Transfer Self");
    await expect(
      ctx.caller().trips.transferOwnership({ tripId, newOwnerId: ctx.user.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await roleOf(ctx, tripId, ctx.user.id)).toBe("Owner");
  });

  it("transferOwnership — planner cannot transfer, and nobody's role changes", async () => {
    const tripId = await crewTrip(ctx, "Transfer Organizer");
    const member = ctx.getUser("member");
    await expect(
      ctx.callerAs("planner").trips.transferOwnership({ tripId, newOwnerId: member.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await roleOf(ctx, tripId, ctx.user.id)).toBe("Owner");
    expect(await roleOf(ctx, tripId, member.id)).toBe("Member");
  });

  it("transferOwnership — cannot transfer to someone who is not on the trip", async () => {
    const tripId = await crewTrip(ctx, "Transfer Outsider");
    const outsider = ctx.getUser("outsider");
    expect(await roleOf(ctx, tripId, outsider.id)).toBeNull(); // premise: really not on it
    await expect(
      ctx.caller().trips.transferOwnership({ tripId, newOwnerId: outsider.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await roleOf(ctx, tripId, ctx.user.id)).toBe("Owner");
  });

  it("delete — member cannot delete, and the trip is still there", async () => {
    const tripId = await crewTrip(ctx, "Delete Member");
    expect(await tripRow(ctx, tripId)).not.toBeNull();
    await expect(ctx.callerAs("member").trips.delete({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await tripRow(ctx, tripId)).not.toBeNull();
  });

  it("delete — owner can delete, and the trip is gone", async () => {
    const tripId = await crewTrip(ctx, "Delete Owner");
    expect(await tripRow(ctx, tripId)).not.toBeNull();
    const result = await ctx.caller().trips.delete({ tripId });
    expect(result.success).toBe(true);
    expect(await tripRow(ctx, tripId)).toBeNull();
  });
});

// ── Destination model tests ────────────────────────────────────────────
// There is no stored stage — a trip's phase is derived from whether a
// destination is locked (locked_destination_at) plus its dates.

describe("trips router — destination model", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function ideaTrip(label: string): Promise<string> {
    const id = `test-dest-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await ctx.caller().trips.create({ id, title: `Idea ${label}` });
    ctx.trackTrip(id);
    return id;
  }

  async function lockedTrip(label: string): Promise<string> {
    const id = `test-dest-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await ctx.caller().trips.create({ id, title: `Locked ${label}`, lockedDestination: { title: "Pebble Beach", location: "Monterey, CA" } });
    ctx.trackTrip(id);
    return id;
  }

  it("new trip without a destination has no lock timestamp (idea phase)", async () => {
    const id = await ideaTrip("idea");
    const fetched = await ctx.caller().trips.getById({ tripId: id });
    expect(fetched.locked_destination_at).toBeFalsy();
  });

  it("new trip with a locked destination has a lock timestamp", async () => {
    const id = await lockedTrip("known");
    const fetched = await ctx.caller().trips.getById({ tripId: id });
    expect(fetched.locked_destination_at).toBeTruthy();
  });

  it("lockDestination moves an idea trip forward (sets the lock timestamp)", async () => {
    const id = await ideaTrip("move");
    expect((await ctx.caller().trips.getById({ tripId: id })).locked_destination_at).toBeFalsy(); // premise
    const result = await ctx.caller().trips.lockDestination({ tripId: id, title: "Kohler", location: "Kohler, WI" });
    expect(result.locked_destination_at).toBeTruthy();
    expect(result.comparison_mode).toBe(false);
  });

  it("changeDestination — planner can change once a destination is locked", async () => {
    const id = await lockedTrip("change");
    await ctx.addTripMember(id, "planner", "Organizer");
    const result = await ctx.callerAs("planner").trips.changeDestination({ tripId: id, destination: "Bandon Dunes" });
    expect(result.locked_destination_title).toBe("Bandon Dunes");
  });

  it("changeDestination — rejected while the trip is still an idea", async () => {
    const id = await ideaTrip("nolock");
    await expect(
      ctx.caller().trips.changeDestination({ tripId: id, destination: "Anywhere" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("changeDestination — member cannot call, and the destination is unchanged", async () => {
    const id = await lockedTrip("member");
    await ctx.addTripMember(id, "member", "Member");
    await expect(
      ctx.callerAs("member").trips.changeDestination({ tripId: id, destination: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ctx.caller().trips.getById({ tripId: id })).locked_destination_title).toBe("Pebble Beach");
  });
});

// ── setPollMode — poll mode toggle ────────────────────────────────────────

describe("datePoll router — setPollMode", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** A trip with a locked destination, so the date poll is reachable. */
  async function pollTrip(label: string): Promise<string> {
    const id = `test-poll-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await ctx.caller().trips.create({ id, title: `Poll ${label}` });
    ctx.trackTrip(id);
    const { error } = await ctx.admin
      .from("trips")
      .update({ locked_destination_title: "Test Dest", locked_destination_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`lock destination: ${error.message}`);
    return id;
  }

  async function pollMode(tripId: string): Promise<boolean | null> {
    const { data } = await ctx.admin.from("trips").select("poll_mode").eq("id", tripId).single();
    return (data?.poll_mode as boolean | null) ?? null;
  }

  it("setPollMode — owner can flip poll_mode on", async () => {
    const id = await pollTrip("on");
    expect(await pollMode(id)).not.toBe(true); // premise: starts off
    await ctx.caller().datePoll.setPollMode({ tripId: id, pollMode: true });
    expect(await pollMode(id)).toBe(true);
  });

  it("setPollMode — owner can flip poll_mode off", async () => {
    const id = await pollTrip("off");
    await ctx.caller().datePoll.setPollMode({ tripId: id, pollMode: true });
    expect(await pollMode(id)).toBe(true); // premise: it is ON before we turn it off
    await ctx.caller().datePoll.setPollMode({ tripId: id, pollMode: false });
    expect(await pollMode(id)).toBe(false);
  });

  it("setPollMode — member cannot call, and poll_mode is unchanged", async () => {
    const id = await pollTrip("member");
    await ctx.addTripMember(id, "member", "Member");
    const before = await pollMode(id);
    await expect(
      ctx.callerAs("member").datePoll.setPollMode({ tripId: id, pollMode: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await pollMode(id)).toBe(before);
  });

  it("setPollMode(false) — clears date windows and votes", async () => {
    const clearTripId = await pollTrip("cancel");
    const caller = ctx.caller();
    await caller.datePoll.setPollMode({ tripId: clearTripId, pollMode: true });

    const w1 = `w1-${Date.now()}`;
    const w2 = `w2-${Date.now()}`;
    await caller.datePoll.addWindow({ tripId: clearTripId, id: w1, startDate: "2026-10-01", endDate: "2026-10-04" });
    await caller.datePoll.addWindow({ tripId: clearTripId, id: w2, startDate: "2026-11-01", endDate: "2026-11-05" });
    await ctx.addTripMember(clearTripId, "member", "Member");

    await caller.datePoll.castDateVote({ tripId: clearTripId, windowId: w1, answer: "yes" });
    await caller.datePoll.castDateVote({ tripId: clearTripId, windowId: w2, answer: "maybe" });
    await ctx.callerAs("member").datePoll.castDateVote({ tripId: clearTripId, windowId: w1, answer: "no" });

    // Premise: the windows and votes exist before the cancel.
    let poll = await caller.datePoll.get({ tripId: clearTripId });
    expect(poll.windows.length).toBe(2);
    expect(poll.windows.reduce((sum, w) => sum + w.votes.length, 0)).toBe(3);

    await caller.datePoll.setPollMode({ tripId: clearTripId, pollMode: false });

    poll = await caller.datePoll.get({ tripId: clearTripId });
    expect(poll.windows.length).toBe(0);
    const { count: voteCount } = await ctx.admin
      .from("date_poll_votes")
      .select("window_id", { count: "exact", head: true })
      .in("window_id", [w1, w2]);
    expect(voteCount).toBe(0);
    expect(await pollMode(clearTripId)).toBe(false);
  });
});
