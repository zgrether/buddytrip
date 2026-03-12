import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  createAnonCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("trips router", () => {
  const ownerId = randomUUID();
  const plannerId = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const tripId = `test-trip-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    // Seed users
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner User", nickname: "Owner", email: `owner-${ownerId}@test.com` },
      { id: plannerId, name: "Planner User", nickname: "Planner", email: `planner-${plannerId}@test.com` },
      { id: memberId, name: "Member User", nickname: "Member", email: `member-${memberId}@test.com` },
      { id: outsiderId, name: "Outsider User", nickname: "Outsider", email: `outsider-${outsiderId}@test.com` },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    // Clean up trip_members first (FK constraint)
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, plannerId, memberId, outsiderId]);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  it("create — any user can create a trip and becomes Owner", async () => {
    const caller = createTestCaller(ownerId);
    const trip = await caller.trips.create({
      id: tripId,
      title: "Test Trip",
      description: "A test trip",
    });
    expect(trip.id).toBe(tripId);
    expect(trip.title).toBe("Test Trip");

    // Verify creator is Owner
    const admin = getAdminClient();
    const { data: member } = await admin
      .from("trip_members")
      .select("role, status")
      .eq("trip_id", tripId)
      .eq("user_id", ownerId)
      .single();
    expect(member?.role).toBe("Owner");
    expect(member?.status).toBe("in");
  });

  // Add other members for subsequent tests
  it("setup — add planner and member", async () => {
    const admin = getAdminClient();
    await admin.from("trip_members").upsert([
      { trip_id: tripId, user_id: plannerId, role: "Planner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  it("list — returns trips for the current user", async () => {
    const caller = createTestCaller(ownerId);
    const trips = await caller.trips.list();
    expect(trips.some((t: { id: string }) => t.id === tripId)).toBe(true);
  });

  it("list — outsider sees no trips", async () => {
    const caller = createTestCaller(outsiderId);
    const trips = await caller.trips.list();
    expect(trips.some((t: { id: string }) => t.id === tripId)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------
  it("getById — member can view trip", async () => {
    const caller = createTestCaller(memberId);
    const trip = await caller.trips.getById({ tripId });
    expect(trip.id).toBe(tripId);
  });

  it("getById — outsider is FORBIDDEN", async () => {
    const caller = createTestCaller(outsiderId);
    await expect(caller.trips.getById({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  it("update — planner can edit trip", async () => {
    const caller = createTestCaller(plannerId);
    const updated = await caller.trips.update({
      tripId,
      title: "Updated Title",
    });
    expect(updated.title).toBe("Updated Title");
  });

  it("update — member cannot edit trip", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.trips.update({ tripId, title: "Hacked" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // -------------------------------------------------------------------------
  // lockDestination / unlockDestination
  // -------------------------------------------------------------------------
  it("lockDestination — owner can lock", async () => {
    const caller = createTestCaller(ownerId);
    const trip = await caller.trips.lockDestination({
      tripId,
      title: "Pebble Beach",
      location: "Monterey, CA",
    });
    expect(trip.locked_destination_title).toBe("Pebble Beach");
    expect(trip.comparison_mode).toBe(false);
  });

  it("lockDestination — planner cannot lock", async () => {
    const caller = createTestCaller(plannerId);
    await expect(
      caller.trips.lockDestination({
        tripId,
        title: "Somewhere",
        location: "Nowhere",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unlockDestination — owner can unlock", async () => {
    const caller = createTestCaller(ownerId);
    const trip = await caller.trips.unlockDestination({ tripId });
    expect(trip.locked_destination_title).toBeNull();
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  it("delete — member cannot delete", async () => {
    const caller = createTestCaller(memberId);
    await expect(caller.trips.delete({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("delete — owner can delete", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.trips.delete({ tripId });
    expect(result.success).toBe(true);
  });
});
