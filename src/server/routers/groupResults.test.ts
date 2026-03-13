import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("groupResults router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-results-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const roundId = `rnd-${randomUUID().slice(0, 8)}`;
  const groupId = `grp-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Results Test" });
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
    await admin.from("rounds").insert({
      id: roundId,
      event_id: eventId,
      day: 1,
      title: "Day 1",
      course: "Test Course",
      format: "scramble",
      points_available: 4,
    });
    await admin.from("play_groups").insert({
      id: groupId,
      event_id: eventId,
      name: "Group 1",
      tee_time: "8:00 AM",
      player_ids: [ownerId, memberId],
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("group_result_scores").delete().eq("round_id", roundId);
    await admin.from("group_results").delete().eq("round_id", roundId);
    await admin.from("play_groups").delete().eq("event_id", eventId);
    await admin.from("rounds").delete().eq("event_id", eventId);
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("submit — any member can submit a result with scores", async () => {
    const caller = createTestCaller(memberId);
    const result = await caller.groupResults.submit({
      tripId,
      roundId,
      groupId,
      eventId,
      scores: [
        { teamId: "team-a", points: 1 },
        { teamId: "team-b", points: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("list — member can view results", async () => {
    const caller = createTestCaller(memberId);
    const results = await caller.groupResults.list({ tripId, roundId });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("submit — idempotent (upsert with new scores)", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.groupResults.submit({
      tripId,
      roundId,
      groupId,
      eventId,
      scores: [
        { teamId: "team-a", points: 0.5 },
        { teamId: "team-b", points: 0.5 },
      ],
    });
    expect(result.success).toBe(true);
  });
});
