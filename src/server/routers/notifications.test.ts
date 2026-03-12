import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("notifications router", () => {
  const ownerId = randomUUID();
  const tripId = `test-notif-${randomUUID().slice(0, 8)}`;
  const notifId = `notif-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Notif Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
    ]);
    // Seed a notification
    await admin.from("notification_events").insert({
      id: notifId,
      trip_id: tripId,
      actor_id: ownerId,
      type: "destination_locked",
      payload: { destination: "Scottsdale, AZ" },
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("notification_reads").delete().eq("notification_id", notifId);
    await admin.from("notification_events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId]);
  });

  it("list — returns notifications with read state", async () => {
    const caller = createTestCaller(ownerId);
    const notifs = await caller.notifications.list({ tripId });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs[0].read).toBe(false);
  });

  it("markAllRead — marks all as read", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.notifications.markAllRead({ tripId });
    expect(result.marked).toBeGreaterThanOrEqual(1);

    // Verify they're now read
    const notifs = await caller.notifications.list({ tripId });
    expect(notifs.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it("markAllRead — idempotent (marks 0 if already read)", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.notifications.markAllRead({ tripId });
    expect(result.marked).toBe(0);
  });
});
