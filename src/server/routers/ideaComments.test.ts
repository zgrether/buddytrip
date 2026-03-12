import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("ideaComments router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-comments-${randomUUID().slice(0, 8)}`;
  const ideaId = `idea-${randomUUID().slice(0, 8)}`;
  const commentId = `comment-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Comments Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
    await admin.from("ideas").insert({
      id: ideaId,
      trip_id: tripId,
      title: "Test Idea",
      location: "Test Location",
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("idea_comments").delete().eq("trip_id", tripId);
    await admin.from("ideas").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("create — any member can comment", async () => {
    const caller = createTestCaller(memberId);
    const comment = await caller.ideaComments.create({
      tripId,
      ideaId,
      id: commentId,
      text: "Great idea!",
    });
    expect(comment.text).toBe("Great idea!");
    expect(comment.user_id).toBe(memberId);
  });

  it("list — returns comments for an idea", async () => {
    const caller = createTestCaller(ownerId);
    const comments = await caller.ideaComments.list({ tripId, ideaId });
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments[0].text).toBe("Great idea!");
  });
});
