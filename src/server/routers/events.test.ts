import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("events router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-events-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Events Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("upsert — owner can create an event", async () => {
    const caller = createTestCaller(ownerId);
    const event = await caller.events.upsert({
      tripId,
      id: eventId,
      title: "BBMI 2026",
      location: "Bandon Dunes, OR",
      dates: "Oct 5-8, 2026",
    });
    expect(event.title).toBe("BBMI 2026");
  });

  it("upsert — member cannot create", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.events.upsert({
        tripId,
        id: `evt-${randomUUID().slice(0, 8)}`,
        title: "Nope",
        location: "Nowhere",
        dates: "Never",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getByTrip — any member can view", async () => {
    const caller = createTestCaller(memberId);
    const event = await caller.events.getByTrip({ tripId });
    expect(event?.title).toBe("BBMI 2026");
  });

  it("upsert — updates existing event", async () => {
    const caller = createTestCaller(ownerId);
    const event = await caller.events.upsert({
      tripId,
      id: eventId,
      title: "BBMI 2026 Updated",
      location: "Bandon Dunes, OR",
      dates: "Oct 5-8, 2026",
      status: "active",
    });
    expect(event.title).toBe("BBMI 2026 Updated");
    expect(event.status).toBe("active");
  });
});
