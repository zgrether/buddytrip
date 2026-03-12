import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("playGroups router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-groups-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const groupId = `grp-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Groups Test" });
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
    await admin.from("play_groups").delete().eq("event_id", eventId);
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("create — owner can create a play group", async () => {
    const caller = createTestCaller(ownerId);
    const group = await caller.playGroups.create({
      tripId,
      id: groupId,
      eventId,
      name: "Group 1",
      teeTime: "8:00 AM",
      playerIds: [ownerId, memberId],
    });
    expect(group.name).toBe("Group 1");
    expect(group.player_ids).toContain(ownerId);
  });

  it("list — member can view groups", async () => {
    const caller = createTestCaller(memberId);
    const groups = await caller.playGroups.list({ tripId, eventId });
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update", async () => {
    const caller = createTestCaller(ownerId);
    const updated = await caller.playGroups.update({
      tripId,
      groupId,
      teeTime: "9:00 AM",
    });
    expect(updated.tee_time).toBe("9:00 AM");
  });
});
