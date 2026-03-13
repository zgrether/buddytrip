import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("scoreboardShares router", () => {
  const ownerId = randomUUID();
  const tripId = `test-share-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-share-${randomUUID().slice(0, 8)}`;
  let shareCode: string;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      {
        id: ownerId,
        name: "ShareOwner",
        nickname: "SO",
        email: `so-${ownerId}@test.com`,
      },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Share Test" });
    await admin.from("trip_members").insert({
      trip_id: tripId,
      user_id: ownerId,
      role: "Owner",
      status: "in",
    });
    await admin.from("events").insert({
      id: eventId,
      trip_id: tripId,
      title: "Share Event",
      location: "Test",
      dates: "2026",
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    if (shareCode) {
      await admin
        .from("scoreboard_shares")
        .delete()
        .eq("id", shareCode);
    }
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId]);
  });

  it("create — generates a share code for an event", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.scoreboardShares.create({
      tripId,
      eventId,
    });
    expect(result.shareCode).toBeTruthy();
    expect(result.shareCode).toMatch(/^sb-/);
    shareCode = result.shareCode;
  });

  it("create — idempotent (returns same code)", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.scoreboardShares.create({
      tripId,
      eventId,
    });
    expect(result.shareCode).toBe(shareCode);
  });

  it("getScoreboard — returns event data for valid share code", async () => {
    const caller = createTestCaller(ownerId);
    const data = await caller.scoreboardShares.getScoreboard({
      shareCode,
    });
    expect(data.event.id).toBe(eventId);
    expect(data.tripId).toBe(tripId);
    expect(Array.isArray(data.teams)).toBe(true);
    expect(Array.isArray(data.rounds)).toBe(true);
  });

  it("getScoreboard — throws NOT_FOUND for invalid code", async () => {
    const caller = createTestCaller(ownerId);
    await expect(
      caller.scoreboardShares.getScoreboard({
        shareCode: "invalid-code",
      })
    ).rejects.toThrow();
  });
});
