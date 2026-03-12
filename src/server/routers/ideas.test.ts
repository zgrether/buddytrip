import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("ideas router", () => {
  const ownerId = randomUUID();
  const plannerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-ideas-${randomUUID().slice(0, 8)}`;
  const ideaId = `idea-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: plannerId, name: "Planner", nickname: "Plan", email: `plan-${plannerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Ideas Test Trip" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: plannerId, role: "Planner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("idea_votes").delete().eq("trip_id", tripId);
    await admin.from("ideas").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, plannerId, memberId]);
  });

  it("create — planner can create an idea", async () => {
    const caller = createTestCaller(plannerId);
    const idea = await caller.ideas.create({
      tripId,
      id: ideaId,
      title: "Scottsdale",
      location: "Scottsdale, AZ",
    });
    expect(idea.id).toBe(ideaId);
    expect(idea.title).toBe("Scottsdale");
  });

  it("create — member cannot create", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.ideas.create({
        tripId,
        id: `idea-${randomUUID().slice(0, 8)}`,
        title: "Nope",
        location: "Nowhere",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can list ideas with votes", async () => {
    const caller = createTestCaller(memberId);
    const ideas = await caller.ideas.list({ tripId });
    expect(ideas.length).toBeGreaterThanOrEqual(1);
    expect(ideas[0].votes).toBeDefined();
  });

  it("update — planner can edit idea", async () => {
    const caller = createTestCaller(plannerId);
    const updated = await caller.ideas.update({
      tripId,
      ideaId,
      description: "Great golf destination",
    });
    expect(updated.description).toBe("Great golf destination");
  });

  it("vote — member can vote (toggle on)", async () => {
    const caller = createTestCaller(memberId);
    const result = await caller.ideas.vote({ tripId, ideaId });
    expect(result.voted).toBe(true);
  });

  it("vote — member can vote again (toggle off)", async () => {
    const caller = createTestCaller(memberId);
    const result = await caller.ideas.vote({ tripId, ideaId });
    expect(result.voted).toBe(false);
  });

  it("remove — planner cannot remove", async () => {
    const caller = createTestCaller(plannerId);
    await expect(caller.ideas.remove({ tripId, ideaId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — owner can remove", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.ideas.remove({ tripId, ideaId });
    expect(result.success).toBe(true);
  });
});
