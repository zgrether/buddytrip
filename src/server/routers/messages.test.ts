import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("messages router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-msg-${randomUUID().slice(0, 8)}`;
  const msgId = `msg-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Messages Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("messages").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("send — member can send a trip message", async () => {
    const caller = createTestCaller(memberId);
    const msg = await caller.messages.send({
      tripId,
      id: msgId,
      text: "Hello everyone!",
    });
    expect(msg.text).toBe("Hello everyone!");
    expect(msg.channel).toBe("trip");
  });

  it("list — member can view trip messages", async () => {
    const caller = createTestCaller(memberId);
    const msgs = await caller.messages.list({ tripId });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].text).toBe("Hello everyone!");
  });

  it("send — team channel requires teamId", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.messages.send({
        tripId,
        id: `msg-${randomUUID().slice(0, 8)}`,
        channel: "team",
        text: "Team message",
      })
    ).rejects.toThrow("teamId is required");
  });
});
