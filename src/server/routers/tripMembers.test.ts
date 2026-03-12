import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("tripMembers router", () => {
  const ownerId = randomUUID();
  const plannerId = randomUUID();
  const memberId = randomUUID();
  const newUserId = randomUUID();
  const tripId = `test-members-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: plannerId, name: "Planner", nickname: "Plan", email: `plan-${plannerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
      { id: newUserId, name: "New User", nickname: "New", email: `new-${newUserId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Members Test Trip" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: plannerId, role: "Planner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, plannerId, memberId, newUserId]);
  });

  // list
  it("list — any member can view crew roster", async () => {
    const caller = createTestCaller(memberId);
    const members = await caller.tripMembers.list({ tripId });
    expect(members.length).toBe(3);
    expect(members[0].user).toBeTruthy();
  });

  // add
  it("add — planner can add a member", async () => {
    const caller = createTestCaller(plannerId);
    const member = await caller.tripMembers.add({
      tripId,
      userId: newUserId,
    });
    expect(member.user_id).toBe(newUserId);
    expect(member.role).toBe("Member");
  });

  it("add — member cannot add", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.tripMembers.add({ tripId, userId: randomUUID() })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("add — duplicate throws CONFLICT", async () => {
    const caller = createTestCaller(plannerId);
    await expect(
      caller.tripMembers.add({ tripId, userId: newUserId })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // updateRole
  it("updateRole — owner can promote member to planner", async () => {
    const caller = createTestCaller(ownerId);
    const updated = await caller.tripMembers.updateRole({
      tripId,
      userId: newUserId,
      role: "Planner",
    });
    expect(updated.role).toBe("Planner");
  });

  it("updateRole — owner cannot change own role", async () => {
    const caller = createTestCaller(ownerId);
    await expect(
      caller.tripMembers.updateRole({ tripId, userId: ownerId, role: "Member" })
    ).rejects.toThrow("Cannot change your own role");
  });

  it("updateRole — planner cannot change roles", async () => {
    const caller = createTestCaller(plannerId);
    await expect(
      caller.tripMembers.updateRole({ tripId, userId: memberId, role: "Planner" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // updateRsvp
  it("updateRsvp — member can update own RSVP", async () => {
    const caller = createTestCaller(memberId);
    const updated = await caller.tripMembers.updateRsvp({
      tripId,
      status: "in",
    });
    expect(updated.status).toBe("in");
  });

  // remove
  it("remove — owner cannot remove self", async () => {
    const caller = createTestCaller(ownerId);
    await expect(
      caller.tripMembers.remove({ tripId, userId: ownerId })
    ).rejects.toThrow("Cannot remove yourself");
  });

  it("remove — owner can remove a member", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.tripMembers.remove({ tripId, userId: newUserId });
    expect(result.success).toBe(true);
  });
});
