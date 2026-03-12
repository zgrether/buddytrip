import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("reservations router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-res-${randomUUID().slice(0, 8)}`;
  const resId = `res-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Reservations Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("reservations").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("create — owner can create a reservation", async () => {
    const caller = createTestCaller(ownerId);
    const res = await caller.reservations.create({
      tripId,
      id: resId,
      type: "tee-time",
      title: "Bandon Dunes Round 1",
      date: "2026-10-06",
      startTime: "8:00 AM",
      cost: 350,
    });
    expect(res.title).toBe("Bandon Dunes Round 1");
  });

  it("create — member cannot create", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.reservations.create({
        tripId,
        id: `res-${randomUUID().slice(0, 8)}`,
        type: "restaurant",
        title: "Nope",
        date: "2026-10-06",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view", async () => {
    const caller = createTestCaller(memberId);
    const list = await caller.reservations.list({ tripId });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update", async () => {
    const caller = createTestCaller(ownerId);
    const updated = await caller.reservations.update({
      tripId,
      reservationId: resId,
      cost: 400,
    });
    expect(Number(updated.cost)).toBe(400);
  });

  it("remove — owner can remove", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.reservations.remove({ tripId, reservationId: resId });
    expect(result.success).toBe(true);
  });
});
