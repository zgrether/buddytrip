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
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
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

  // Stage must be 'going' for member visibility (RLS: idea/planning = planner-only)
  it("setup — advance to going for member visibility", async () => {
    await ctx.admin.from("trips").update({ stage: "planning" }).eq("id", tripId);
    await ctx.admin.from("trips").update({ stage: "going" }).eq("id", tripId);
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

  // update
  it("update — planner can edit trip", async () => {
    const caller = ctx.callerAs("planner");
    const updated = await caller.trips.update({ tripId, title: "Updated Title" });
    expect(updated.title).toBe("Updated Title");
  });

  it("update — member cannot edit trip", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.trips.update({ tripId, title: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // lockDestination / unlockDestination
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

  it("unlockDestination — owner can unlock and restores comparison_mode", async () => {
    const caller = ctx.caller();
    const trip = await caller.trips.unlockDestination({ tripId });
    expect(trip.locked_destination_title).toBeNull();
    expect(trip.comparison_mode).toBe(true);
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
      coplanners: [{ userId: planner.id, role: "Planner" }],
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
    expect(plannerMember!.role).toBe("Planner");
  });

  // renameTripName
  it("renameTripName — owner can rename", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.renameTripName({ tripId, name: "Renamed Trip" });
    expect(result.name).toBe("Renamed Trip");
  });

  it("renameTripName — planner can rename", async () => {
    const caller = ctx.callerAs("planner");
    const result = await caller.trips.renameTripName({ tripId, name: "Planner Renamed" });
    expect(result.name).toBe("Planner Renamed");
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
    expect(oldOwner?.role).toBe("Planner");
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

  // saveTrip
  it("saveTrip — owner can save", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.saveTrip({ tripId });
    expect(result.trip_status_override).toBe("saved");
    expect(result.saved_at).toBeTruthy();
  });

  it("saveTrip — planner cannot save", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.trips.saveTrip({ tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Clear saved status so delete works normally
  it("setup — clear saved status", async () => {
    await ctx.admin
      .from("trips")
      .update({ trip_status_override: null, saved_at: null })
      .eq("id", tripId);
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

// ── Stage model tests ──────────────────────────────────────────────────

describe("trips router — stage model", () => {
  let ctx: TestContext;
  let stageTrip: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    if (stageTrip) ctx.trackTrip(stageTrip);
    await ctx.cleanup();
  });

  it("new trip without locked destination starts in idea stage", async () => {
    const caller = ctx.caller();
    const id = `test-stage-idea-${Date.now()}`;
    const trip = await caller.trips.create({ id, title: "Stage Test" });
    ctx.trackTrip(id);
    stageTrip = id;

    const fetched = await caller.trips.getById({ tripId: id });
    expect((fetched as { stage: string }).stage).toBe("idea");
  });

  it("new trip with locked destination starts in planning stage", async () => {
    const caller = ctx.caller();
    const id = `test-stage-known-${Date.now()}`;
    const trip = await caller.trips.create({
      id,
      title: "Known Dest Stage",
      lockedDestination: { title: "Pebble Beach", location: "Monterey, CA" },
    });
    ctx.trackTrip(id);

    const fetched = await caller.trips.getById({ tripId: id });
    expect((fetched as { stage: string }).stage).toBe("planning");
  });

  it("advanceToPlanning — owner can advance from idea with locked destination", async () => {
    // Lock destination on the idea trip
    const caller = ctx.caller();
    await caller.trips.lockDestination({
      tripId: stageTrip,
      title: "Kohler",
      location: "Kohler, WI",
    });

    const result = await caller.trips.advanceToPlanning({ tripId: stageTrip });
    expect(result.stage).toBe("planning");
  });

  it("advanceToPlanning — cannot advance from planning", async () => {
    const caller = ctx.caller();
    await expect(
      caller.trips.advanceToPlanning({ tripId: stageTrip })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("advanceToPlanning — planner cannot call", async () => {
    // Create a fresh idea trip for this test
    const id = `test-stage-planner-${Date.now()}`;
    const caller = ctx.caller();
    await caller.trips.create({ id, title: "Planner Test" });
    ctx.trackTrip(id);
    await ctx.addTripMember(id, "planner", "Planner");
    await caller.trips.lockDestination({
      tripId: id,
      title: "Test",
      location: "Test",
    });

    const plannerCaller = ctx.callerAs("planner");
    await expect(
      plannerCaller.trips.advanceToPlanning({ tripId: id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("advanceToGoing — requires locked date", async () => {
    const caller = ctx.caller();
    await expect(
      caller.trips.advanceToGoing({ tripId: stageTrip, aboutMessage: "Let's go!" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("changeDestination — planner can change in planning stage", async () => {
    await ctx.addTripMember(stageTrip, "planner", "Planner");
    const caller = ctx.callerAs("planner");
    const result = await caller.trips.changeDestination({
      tripId: stageTrip,
      destination: "Bandon Dunes",
    });
    expect(result.locked_destination_title).toBe("Bandon Dunes");
  });

  it("changeDestination — member cannot call", async () => {
    await ctx.addTripMember(stageTrip, "member", "Member");
    const caller = ctx.callerAs("member");
    await expect(
      caller.trips.changeDestination({ tripId: stageTrip, destination: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── enableItinerary / enableGettingThere — panel activation flags ─────
  // Reuses stageTrip — planner/member were added by the changeDestination
  // tests above, so we don't need to re-add them here.
  it("enableItinerary — owner flips itinerary_enabled to true", async () => {
    const caller = ctx.caller();
    const res = await caller.trips.enableItinerary({ tripId: stageTrip });
    expect(res.success).toBe(true);
    const { data } = await ctx.admin
      .from("trips")
      .select("itinerary_enabled")
      .eq("id", stageTrip)
      .single();
    expect(data?.itinerary_enabled).toBe(true);
  });

  it("enableItinerary — planner can activate", async () => {
    const plannerCaller = ctx.callerAs("planner");
    const res = await plannerCaller.trips.enableItinerary({ tripId: stageTrip });
    expect(res.success).toBe(true);
  });

  it("enableItinerary — member is FORBIDDEN", async () => {
    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.trips.enableItinerary({ tripId: stageTrip })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enableGettingThere — owner flips getting_there_enabled to true", async () => {
    const caller = ctx.caller();
    const res = await caller.trips.enableGettingThere({ tripId: stageTrip });
    expect(res.success).toBe(true);
    const { data } = await ctx.admin
      .from("trips")
      .select("getting_there_enabled")
      .eq("id", stageTrip)
      .single();
    expect(data?.getting_there_enabled).toBe(true);
  });

  it("enableGettingThere — member is FORBIDDEN", async () => {
    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.trips.enableGettingThere({ tripId: stageTrip })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("disableItinerary — owner flips itinerary_enabled back to false", async () => {
    const caller = ctx.caller();
    const res = await caller.trips.disableItinerary({ tripId: stageTrip });
    expect(res.success).toBe(true);
    const { data } = await ctx.admin
      .from("trips")
      .select("itinerary_enabled")
      .eq("id", stageTrip)
      .single();
    expect(data?.itinerary_enabled).toBe(false);
  });

  it("disableGettingThere — owner flips getting_there_enabled back to false", async () => {
    const caller = ctx.caller();
    const res = await caller.trips.disableGettingThere({ tripId: stageTrip });
    expect(res.success).toBe(true);
    const { data } = await ctx.admin
      .from("trips")
      .select("getting_there_enabled")
      .eq("id", stageTrip)
      .single();
    expect(data?.getting_there_enabled).toBe(false);
  });

  it("dismissQuickInfo — owner flips quick_info_dismissed to true", async () => {
    const caller = ctx.caller();
    const res = await caller.trips.dismissQuickInfo({ tripId: stageTrip });
    expect(res.success).toBe(true);
    const { data } = await ctx.admin
      .from("trips")
      .select("quick_info_dismissed")
      .eq("id", stageTrip)
      .single();
    expect(data?.quick_info_dismissed).toBe(true);
  });

  it("dismissQuickInfo — member is FORBIDDEN", async () => {
    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.trips.dismissQuickInfo({ tripId: stageTrip })
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
      .update({ stage: "planning", locked_destination_title: "Test Dest" })
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

  it("setPollMode(false) — clears date windows, votes, and resets notify_sent", async () => {
    // Fresh trip so we don't collide with other tests in this describe block.
    const clearTripId = `test-poll-cancel-${Date.now()}`;
    const caller = ctx.caller();
    await caller.trips.create({ id: clearTripId, title: "Cancel Poll Test" });
    ctx.trackTrip(clearTripId);
    await ctx.admin
      .from("trips")
      .update({ stage: "planning", locked_destination_title: "Test Dest" })
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

    // Verify notify_sent was reset.
    expect(poll.notifySent).toBe(false);

    // Verify poll_mode is false on the trip.
    const { data: tripRow } = await ctx.admin
      .from("trips")
      .select("poll_mode")
      .eq("id", clearTripId)
      .single();
    expect(tripRow?.poll_mode).toBe(false);
  });
});

// ── setOwnerAlert ──────────────────────────────────────────────────────

describe("trips router — setOwnerAlert", () => {
  let ctx: TestContext;
  let alertTripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    alertTripId = await ctx.createTrip("Alert Test");
    await ctx.addTripMember(alertTripId, "planner", "Planner");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("setOwnerAlert — owner can set alert", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.setOwnerAlert({
      tripId: alertTripId,
      alert: "Flight delayed — meet at bar instead",
    });
    expect(result.owner_alert).toBe("Flight delayed — meet at bar instead");
    expect(result.owner_alert_set_at).toBeTruthy();
  });

  it("setOwnerAlert — owner can clear alert", async () => {
    const caller = ctx.caller();
    const result = await caller.trips.setOwnerAlert({
      tripId: alertTripId,
      alert: null,
    });
    expect(result.owner_alert).toBeNull();
    expect(result.owner_alert_set_at).toBeNull();
  });

  it("setOwnerAlert — planner cannot set alert", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.trips.setOwnerAlert({ tripId: alertTripId, alert: "Nope" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── skipPlanningTile / unskipPlanningTile ────────────────────────────────

describe("trips router — planning tile skip", () => {
  let ctx: TestContext;
  let skipTripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    skipTripId = await ctx.createTrip("Skip Tile Test");
    await ctx.addTripMember(skipTripId, "planner", "Planner");
    await ctx.addTripMember(skipTripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("skipPlanningTile — planner can skip a tile", async () => {
    const caller = ctx.callerAs("planner");
    const res = await caller.trips.skipPlanningTile({
      tripId: skipTripId,
      tile: "lodging",
    });
    expect(res.planning_skipped).toEqual(["lodging"]);
  });

  it("skipPlanningTile — idempotent (same tile twice does not duplicate)", async () => {
    const caller = ctx.callerAs("planner");
    const res = await caller.trips.skipPlanningTile({
      tripId: skipTripId,
      tile: "lodging",
    });
    expect(res.planning_skipped).toEqual(["lodging"]);
  });

  it("skipPlanningTile — stacks multiple tiles", async () => {
    const caller = ctx.callerAs("planner");
    const res = await caller.trips.skipPlanningTile({
      tripId: skipTripId,
      tile: "schedule",
    });
    expect(res.planning_skipped).toEqual(expect.arrayContaining(["lodging", "schedule"]));
    expect(res.planning_skipped).toHaveLength(2);
  });

  it("skipPlanningTile — member is FORBIDDEN", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.trips.skipPlanningTile({ tripId: skipTripId, tile: "crew" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unskipPlanningTile — planner can unskip", async () => {
    const caller = ctx.callerAs("planner");
    const res = await caller.trips.unskipPlanningTile({
      tripId: skipTripId,
      tile: "lodging",
    });
    expect(res.planning_skipped).toEqual(["schedule"]);
  });

  it("unskipPlanningTile — idempotent on missing tile", async () => {
    const caller = ctx.callerAs("planner");
    const res = await caller.trips.unskipPlanningTile({
      tripId: skipTripId,
      tile: "dates",
    });
    expect(res.planning_skipped).toEqual(["schedule"]);
  });

  it("unskipPlanningTile — member is FORBIDDEN", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.trips.unskipPlanningTile({ tripId: skipTripId, tile: "schedule" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── updatePlanningTier ───────────────────────────────────────────────────

describe("trips router — planning tier", () => {
  let ctx: TestContext;
  let tierTripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tierTripId = await ctx.createTrip("Planning Tier Test");
    await ctx.addTripMember(tierTripId, "planner", "Planner");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("updatePlanningTier — owner can flip tier to advanced", async () => {
    const caller = ctx.callerAs("owner");
    const res = await caller.trips.updatePlanningTier({
      tripId: tierTripId,
      tier: "advanced",
    });
    expect(res.planning_tier).toBe("advanced");
  });

  it("updatePlanningTier — owner can flip tier back to basic", async () => {
    const caller = ctx.callerAs("owner");
    const res = await caller.trips.updatePlanningTier({
      tripId: tierTripId,
      tier: "basic",
    });
    expect(res.planning_tier).toBe("basic");
  });

  it("updatePlanningTier — planner is FORBIDDEN (owner-only)", async () => {
    const caller = ctx.callerAs("planner");
    await expect(
      caller.trips.updatePlanningTier({ tripId: tierTripId, tier: "advanced" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
