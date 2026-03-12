import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("sideEvents router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-side-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const sideEventId = `se-${randomUUID().slice(0, 8)}`;
  const teamAId = `team-a-${randomUUID().slice(0, 8)}`;
  const teamBId = `team-b-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Side Events Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
    await admin.from("events").insert({
      id: eventId,
      trip_id: tripId,
      title: "Test Event",
      location: "Test",
      dates: "2026",
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("side_events").delete().eq("event_id", eventId);
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("create — owner can create a side event", async () => {
    const caller = createTestCaller(ownerId);
    const se = await caller.sideEvents.create({
      tripId,
      id: sideEventId,
      eventId,
      name: "Closest to Pin",
      icon: "🎯",
      pointsAvailable: 1,
    });
    expect(se.id).toBe(sideEventId);
    expect(se.name).toBe("Closest to Pin");
  });

  it("create — member cannot create", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.sideEvents.create({
        tripId,
        id: `se-${randomUUID().slice(0, 8)}`,
        eventId,
        name: "Nope",
        icon: "❌",
        pointsAvailable: 1,
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("list — member can list side events", async () => {
    const caller = createTestCaller(memberId);
    const list = await caller.sideEvents.list({ tripId, eventId });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("submitResult — owner can submit result", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.sideEvents.submitResult({
      tripId,
      sideEventId,
      result: { [teamAId]: 1, [teamBId]: 0 },
    });
    expect(result.status).toBe("complete");
    expect(result.result).toEqual({ [teamAId]: 1, [teamBId]: 0 });
  });

  it("submitResult — member cannot submit", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.sideEvents.submitResult({
        tripId,
        sideEventId,
        result: { [teamAId]: 0, [teamBId]: 1 },
      })
    ).rejects.toThrow("FORBIDDEN");
  });
});
