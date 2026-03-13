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
