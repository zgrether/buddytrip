import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("trips router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    if (tripId) ctx.trackTrip(tripId);
    await ctx.cleanup();
  });

  // create
  it("create — any user can create a trip and becomes Owner", async () => {
    const caller = ctx.caller();
    const trip = await caller.trips.create({
      id: `test-trip-${Date.now()}`,
      title: "Test Trip",
      description: "A test trip",
    });
    tripId = trip.id;
    expect(trip.title).toBe("Test Trip");

    const { data: memberRow } = await ctx.admin
      .from("trip_members")
      .select("role, status")
      .eq("trip_id", tripId)
      .eq("user_id", ctx.user.id)
      .single();
    expect(memberRow?.role).toBe("Owner");
    expect(memberRow?.status).toBe("in");
  });

  it("setup — add planner and member", async () => {
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  // resolveSlug
  it("resolveSlug — maps slug AND id to the canonical id; unknown → NOT_FOUND", async () => {
    const caller = ctx.caller();
    const { data: row } = await ctx.admin
      .from("trips")
      .select("slug")
      .eq("id", tripId)
      .single();
    const slug = (row as { slug: string }).slug;
    expect(slug).toMatch(/-[0-9a-f]{6}$/);

    expect((await caller.trips.resolveSlug({ slugOrId: slug })).id).toBe(tripId);
    expect((await caller.trips.resolveSlug({ slugOrId: tripId })).id).toBe(tripId);
    await expect(
      caller.trips.resolveSlug({ slugOrId: "no-such-trip-000000" })
    ).rejects.toThrow();
  });

  // list
  it("list — returns trips for the current user", async () => {
    const caller = ctx.caller();
    const trips = await caller.trips.list();
    expect(trips.some((t: { id: string }) => t.id === tripId)).toBe(true);
  });

  it("list — outsider sees no trips", async () => {
    const caller = ctx.callerAs("outsider");
    const trips = await caller.trips.list();
    expect(trips.some((t: { id: string }) => t.id === tripId)).toBe(false);
  });

  // A destination must be locked for member visibility
  // (RLS: idea phase / no destination = planner-only).
  it("setup — lock destination for member visibility", async () => {
    await ctx.admin
      .from("trips")
      .update({ locked_destination_at: new Date().toISOString() })
      .eq("id", tripId);
  });

  // getById
  it("getById — member can view trip", async () => {
    const caller = ctx.callerAs("member");
    const trip = await caller.trips.getById({ tripId });
    expect(trip.id).toBe(tripId);
  });

  it("getById — outsider is FORBIDDEN", async () => {
    const caller = ctx.callerAs("outsider");
    await expect(caller.trips.getById({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // lockDestination
  it("lockDestination — owner can lock", async () => {
    const caller = ctx.caller();
    const trip = await caller.trips.lockDestination({
      tripId,
      title: "Pebble Beach",
      location: "Monterey, CA",
    });
    expect(trip.locked_destination_title).toBe("Pebble Beach");
    expect(trip.comparison_mode).toBe(false);
  });

  it("lockDestination — planner cannot lock", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.trips.lockDestination({ tripId, title: "Somewhere", location: "Nowhere" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // create with comparisonMode + lockedDestination
  it("create — Choice A: creates trip with locked destination", async () => {
    const caller = ctx.caller();
    const id = `test-trip-known-${Date.now()}`;
    const trip = await caller.trips.create({
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
    const caller = ctx.caller();
    const id = `test-trip-vote-${Date.now()}`;
    const trip = await caller.trips.create({
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

    // Verify ideas were seeded
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
    const caller = ctx.caller();
    const id = `test-trip-coplan-${Date.now()}`;
    const planner = ctx.getUser("planner");
    const trip = await caller.trips.create({
      id,
      title: "Coplanners Trip",
      coplanners: [{ userId: planner.id, role: "Organizer" }],
    });
    ctx.trackTrip(id);
    expect(trip.title).toBe("Coplanners Trip");

    // Verify co-planner was added
    const { data: members } = await ctx.admin
      .from("trip_members")
      .select("user_id, role")
      .eq("trip_id", id);
    const plannerMember = members?.find((m) => m.user_id === planner.id);
    expect(plannerMember).toBeTruthy();
    expect(plannerMember!.role).toBe("Organizer");
  });

  // renameTripName
  it("renameTripName — owner can rename", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.renameTripName({ tripId, name: "Renamed Trip" });
    expect(result.name).toBe("Renamed Trip");
  });

  it("renameTripName — planner can rename", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.trips.renameTripName({ tripId, name: "Organizer Renamed" });
    expect(result.name).toBe("Organizer Renamed");
  });

  it("renameTripName — member cannot rename", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.trips.renameTripName({ tripId, name: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // transferOwnership
  it("transferOwnership — owner can transfer to member", async () => {
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const result = await caller.trips.transferOwnership({ tripId, newOwnerId: member.id });
    expect(result.success).toBe(true);

    // Verify roles swapped
    const { data: rows } = await ctx.admin
      .from("trip_members")
      .select("user_id, role")
      .eq("trip_id", tripId)
      .in("user_id", [ctx.user.id, member.id]);
    const oldOwner = rows?.find((r) => r.user_id === ctx.user.id);
    const newOwner = rows?.find((r) => r.user_id === member.id);
    expect(oldOwner?.role).toBe("Organizer");
    expect(newOwner?.role).toBe("Owner");

    // Transfer back so subsequent tests work (owner is now the member user)
    const memberCaller = ctx.callerAs("member"); // member is now Owner
    await memberCaller.trips.transferOwnership({ tripId, newOwnerId: ctx.user.id });
  });

  it("transferOwnership — cannot transfer to self", async () => {
    const caller = ctx.caller();
    await expect(
      caller.trips.transferOwnership({ tripId, newOwnerId: ctx.user.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("transferOwnership — planner cannot transfer", async () => {
    const caller = ctx.callerAs("planner");
    const member = ctx.getUser("member");
    await expect(
      caller.trips.transferOwnership({ tripId, newOwnerId: member.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("transferOwnership — cannot transfer to non-member", async () => {
    const caller = ctx.caller();
    const outsider = ctx.getUser("outsider");
    await expect(
      caller.trips.transferOwnership({ tripId, newOwnerId: outsider.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // delete
  it("delete — member cannot delete", async () => {
    const caller = ctx.callerAs("member");
    await expect(caller.trips.delete({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("delete — owner can delete", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.delete({ tripId });
    expect(result.success).toBe(true);
    tripId = "";
  });
});

// ── Destination model tests ────────────────────────────────────────────
// There is no stored stage — a trip's phase is derived from whether a
// destination is locked (locked_destination_at) plus its dates.

describe("trips router — destination model", () => {
  let ctx: TestContext;
  let stageTrip: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    if (stageTrip) ctx.trackTrip(stageTrip);
    await ctx.cleanup();
  });

  it("new trip without a destination has no lock timestamp (idea phase)", async () => {
    const caller = ctx.caller();
    const id = `test-dest-idea-${Date.now()}`;
    await caller.trips.create({ id, title: "Idea Test" });
    ctx.trackTrip(id);
    stageTrip = id;

    const fetched = await caller.trips.getById({ tripId: id });
    expect(fetched.locked_destination_at).toBeFalsy();
  });

  it("new trip with a locked destination has a lock timestamp", async () => {
    const caller = ctx.caller();
    const id = `test-dest-known-${Date.now()}`;
    await caller.trips.create({
      id,
      title: "Known Dest",
      lockedDestination: { title: "Pebble Beach", location: "Monterey, CA" },
    });
    ctx.trackTrip(id);

    const fetched = await caller.trips.getById({ tripId: id });
    expect(fetched.locked_destination_at).toBeTruthy();
  });

  it("lockDestination moves an idea trip forward (sets the lock timestamp)", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.lockDestination({
      tripId: stageTrip,
      title: "Kohler",
      location: "Kohler, WI",
    });
    expect(result.locked_destination_at).toBeTruthy();
    expect(result.comparison_mode).toBe(false);
  });

  it("changeDestination — planner can change once a destination is locked", async () => {
    await ctx.addTripMember(stageTrip, "planner", "Organizer");
    const caller = ctx.callerAs("planner");
    const result = await caller.trips.changeDestination({
      tripId: stageTrip,
      destination: "Bandon Dunes",
    });
    expect(result.locked_destination_title).toBe("Bandon Dunes");
  });

  it("changeDestination — rejected while the trip is still an idea", async () => {
    const caller = ctx.caller();
    const id = `test-dest-nolock-${Date.now()}`;
    await caller.trips.create({ id, title: "No Lock" });
    ctx.trackTrip(id);
    await expect(
      caller.trips.changeDestination({ tripId: id, destination: "Anywhere" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("changeDestination — member cannot call", async () => {
    await ctx.addTripMember(stageTrip, "member", "Member");
    const caller = ctx.callerAs("member");
    await expect(
      caller.trips.changeDestination({ tripId: stageTrip, destination: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

});

// ── setPollMode — poll mode toggle ────────────────────────────────────────

describe("datePoll router — setPollMode", () => {
  let ctx: TestContext;
  let pollTripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    const caller = ctx.caller();
    const id = `test-poll-mode-${Date.now()}`;
    await caller.trips.create({ id, title: "Poll Mode Test" });
    ctx.trackTrip(id);
    pollTripId = id;
    await ctx.admin
      .from("trips")
      .update({ locked_destination_title: "Test Dest", locked_destination_at: new Date().toISOString() })
      .eq("id", pollTripId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("setPollMode — owner can flip poll_mode on", async () => {
    const caller = ctx.caller();
    await caller.datePoll.setPollMode({ tripId: pollTripId, pollMode: true });
    const { data } = await ctx.admin
      .from("trips")
      .select("poll_mode")
      .eq("id", pollTripId)
      .single();
    expect(data?.poll_mode).toBe(true);
  });

  it("setPollMode — owner can flip poll_mode off", async () => {
    const caller = ctx.caller();
    await caller.datePoll.setPollMode({ tripId: pollTripId, pollMode: false });
    const { data } = await ctx.admin
      .from("trips")
      .select("poll_mode")
      .eq("id", pollTripId)
      .single();
    expect(data?.poll_mode).toBe(false);
  });

  it("setPollMode — member cannot call", async () => {
    await ctx.addTripMember(pollTripId, "member", "Member");
    const caller = ctx.callerAs("member");
    await expect(
      caller.datePoll.setPollMode({ tripId: pollTripId, pollMode: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("setPollMode(false) — clears date windows and votes", async () => {
    // Fresh trip so we don't collide with other tests in this describe block.
    const clearTripId = `test-poll-cancel-${Date.now()}`;
    const caller = ctx.caller();
    await caller.trips.create({ id: clearTripId, title: "Cancel Poll Test" });
    ctx.trackTrip(clearTripId);
    await ctx.admin
      .from("trips")
      .update({ locked_destination_title: "Test Dest", locked_destination_at: new Date().toISOString() })
      .eq("id", clearTripId);

    // Open the poll.
    await caller.datePoll.setPollMode({ tripId: clearTripId, pollMode: true });

    // Add 2 date windows.
    const w1 = `w1-${Date.now()}`;
    const w2 = `w2-${Date.now()}`;
    await caller.datePoll.addWindow({ tripId: clearTripId, id: w1, startDate: "2026-10-01", endDate: "2026-10-04" });
    await caller.datePoll.addWindow({ tripId: clearTripId, id: w2, startDate: "2026-11-01", endDate: "2026-11-05" });

    // Add the shared member user to this trip so they can vote.
    await ctx.addTripMember(clearTripId, "member", "Member");

    // Cast 3 votes (owner votes on both windows; member votes on one).
    await caller.datePoll.castDateVote({ tripId: clearTripId, windowId: w1, answer: "yes" });
    await caller.datePoll.castDateVote({ tripId: clearTripId, windowId: w2, answer: "maybe" });
    const memberCaller = ctx.callerAs("member");
    await memberCaller.datePoll.castDateVote({ tripId: clearTripId, windowId: w1, answer: "no" });

    // Confirm data exists before cancel.
    let poll = await caller.datePoll.get({ tripId: clearTripId });
    expect(poll.windows.length).toBe(2);
    const totalVotesBefore = poll.windows.reduce((sum, w) => sum + w.votes.length, 0);
    expect(totalVotesBefore).toBe(3);

    // Cancel the poll — setPollMode(false) should clear everything.
    await caller.datePoll.setPollMode({ tripId: clearTripId, pollMode: false });

    // Verify windows are gone.
    poll = await caller.datePoll.get({ tripId: clearTripId });
    expect(poll.windows.length).toBe(0);

    // Verify votes are gone (direct DB check via admin).
    const { count: voteCount } = await ctx.admin
      .from("date_poll_votes")
      .select("window_id", { count: "exact", head: true })
      .in("window_id", [w1, w2]);
    expect(voteCount).toBe(0);

    // Verify poll_mode is false on the trip.
    const { data: tripRow } = await ctx.admin
      .from("trips")
      .select("poll_mode")
      .eq("id", clearTripId)
      .single();
    expect(tripRow?.poll_mode).toBe(false);
  });
});


