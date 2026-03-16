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

  it("unlockDestination — owner can unlock", async () => {
    const caller = ctx.caller();
    const trip = await caller.trips.unlockDestination({ tripId });
    expect(trip.locked_destination_title).toBeNull();
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
