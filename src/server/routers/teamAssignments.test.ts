import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("teamAssignments router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-assign-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const teamId = `team-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Assign Test" });
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
    await admin.from("teams").insert({
      id: teamId,
      event_id: eventId,
      name: "Team A",
      short_name: "A",
      color: "#ff0000",
      color_dim: "#ff000040",
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("team_assignments").delete().eq("event_id", eventId);
    await admin.from("teams").delete().eq("event_id", eventId);
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("assign — owner can assign a player", async () => {
    const caller = createTestCaller(ownerId);
    const assignment = await caller.teamAssignments.assign({
      tripId,
      eventId,
      teamId,
      userId: memberId,
    });
    expect(assignment.team_id).toBe(teamId);
  });

  it("list — member can view assignments", async () => {
    const caller = createTestCaller(memberId);
    const assignments = await caller.teamAssignments.list({ tripId, eventId });
    expect(assignments.length).toBeGreaterThanOrEqual(1);
  });

  it("remove — owner can remove assignment", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.teamAssignments.remove({
      tripId,
      eventId,
      userId: memberId,
    });
    expect(result.success).toBe(true);
  });

  it("assign — member cannot assign", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.teamAssignments.assign({
        tripId,
        eventId,
        teamId,
        userId: ownerId,
      })
    ).rejects.toThrow("FORBIDDEN");
  });
});
