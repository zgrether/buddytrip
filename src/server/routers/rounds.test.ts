import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("rounds router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-rounds-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const roundId = `rnd-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Rounds Test" });
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
    await admin.from("group_results").delete().eq("round_id", roundId);
    await admin.from("rounds").delete().eq("event_id", eventId);
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("create — owner can create a round", async () => {
    const caller = createTestCaller(ownerId);
    const round = await caller.rounds.create({
      tripId,
      id: roundId,
      eventId,
      day: 1,
      title: "Day 1 — Scramble",
      course: "Bandon Dunes",
      format: "scramble",
      pointsAvailable: 4,
    });
    expect(round.title).toBe("Day 1 — Scramble");
  });

  it("list — member can view rounds", async () => {
    const caller = createTestCaller(memberId);
    const rounds = await caller.rounds.list({ tripId, eventId });
    expect(rounds.length).toBeGreaterThanOrEqual(1);
  });

  it("update — owner can update round status", async () => {
    const caller = createTestCaller(ownerId);
    const updated = await caller.rounds.update({
      tripId,
      roundId,
      status: "active",
    });
    expect(updated.status).toBe("active");
  });

  it("create — member cannot create", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.rounds.create({
        tripId,
        id: `rnd-${randomUUID().slice(0, 8)}`,
        eventId,
        day: 2,
        title: "Nope",
        course: "Nope",
        format: "skins",
        pointsAvailable: 4,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — owner can remove", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.rounds.remove({ tripId, roundId });
    expect(result.success).toBe(true);
  });
});
