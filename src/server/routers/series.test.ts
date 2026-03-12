import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("series router", () => {
  const ownerUserId = randomUUID();
  const otherUserId = randomUUID();
  const seriesId = `series-${randomUUID().slice(0, 8)}`;
  const tripId = `test-ser-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerUserId, name: "Series Owner", nickname: "SO", email: `so-${ownerUserId}@test.com` },
      { id: otherUserId, name: "Other User", nickname: "OU", email: `ou-${otherUserId}@test.com` },
    ]);
    // Create a trip to link later
    await admin.from("trips").insert({ id: tripId, title: "Series Link Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerUserId, role: "Owner", status: "in" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    // Unlink trip from series first
    await admin.from("trips").update({ series_id: null }).eq("id", tripId);
    await admin.from("series").delete().eq("id", seriesId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerUserId, otherUserId]);
  });

  it("create — user can create a series", async () => {
    const caller = createTestCaller(ownerUserId);
    const s = await caller.series.create({
      id: seriesId,
      name: "BT",
      fullName: "Buddy Trip Series",
      years: "2024-2026",
    });
    expect(s.id).toBe(seriesId);
    expect(s.owner_id).toBe(ownerUserId);
  });

  it("list — owner sees their series", async () => {
    const caller = createTestCaller(ownerUserId);
    const list = await caller.series.list();
    expect(list.some((s: { id: string }) => s.id === seriesId)).toBe(true);
  });

  it("list — other user does not see it", async () => {
    const caller = createTestCaller(otherUserId);
    const list = await caller.series.list();
    expect(list.some((s: { id: string }) => s.id === seriesId)).toBe(false);
  });

  it("linkTrip — owner can link a trip", async () => {
    const caller = createTestCaller(ownerUserId);
    const trip = await caller.series.linkTrip({ seriesId, tripId });
    expect(trip.series_id).toBe(seriesId);
  });

  it("linkTrip — non-owner cannot link", async () => {
    const caller = createTestCaller(otherUserId);
    await expect(
      caller.series.linkTrip({ seriesId, tripId })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("transferOwnership — owner can transfer", async () => {
    const caller = createTestCaller(ownerUserId);
    const s = await caller.series.transferOwnership({
      seriesId,
      newOwnerId: otherUserId,
    });
    expect(s.owner_id).toBe(otherUserId);
  });

  it("transferOwnership — previous owner can no longer transfer", async () => {
    const caller = createTestCaller(ownerUserId);
    await expect(
      caller.series.transferOwnership({
        seriesId,
        newOwnerId: ownerUserId,
      })
    ).rejects.toThrow("FORBIDDEN");
  });
});
