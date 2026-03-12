import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("quickInfoTiles router", () => {
  const ownerId = randomUUID();
  const plannerId = randomUUID();
  const tripId = `test-tiles-${randomUUID().slice(0, 8)}`;
  const tileId = `tile-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: plannerId, name: "Planner", nickname: "Plan", email: `plan-${plannerId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Tiles Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: plannerId, role: "Planner", status: "in" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("quick_info_tiles").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, plannerId]);
  });

  it("create — owner can create a tile", async () => {
    const caller = createTestCaller(ownerId);
    const tile = await caller.quickInfoTiles.create({
      tripId,
      id: tileId,
      label: "Door Code",
      value: "4892",
    });
    expect(tile.label).toBe("Door Code");
    expect(tile.value).toBe("4892");
  });

  it("create — planner cannot create (isOwner gate)", async () => {
    const caller = createTestCaller(plannerId);
    await expect(
      caller.quickInfoTiles.create({
        tripId,
        id: `tile-${randomUUID().slice(0, 8)}`,
        label: "Wifi",
        value: "password123",
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("list — any member can view tiles", async () => {
    const caller = createTestCaller(plannerId);
    const tiles = await caller.quickInfoTiles.list({ tripId });
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update a tile", async () => {
    const caller = createTestCaller(ownerId);
    const updated = await caller.quickInfoTiles.update({
      tripId,
      tileId,
      value: "9999",
    });
    expect(updated.value).toBe("9999");
  });

  it("remove — owner can remove a tile", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.quickInfoTiles.remove({ tripId, tileId });
    expect(result.success).toBe(true);
  });
});
