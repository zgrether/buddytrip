import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("datePoll router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-poll-${randomUUID().slice(0, 8)}`;
  const windowId = `dw-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Poll Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("date_poll_votes").delete().eq("window_id", windowId);
    await admin.from("date_windows").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("addWindow — owner can add a date window", async () => {
    const caller = createTestCaller(ownerId);
    const win = await caller.datePoll.addWindow({
      tripId,
      id: windowId,
      startDate: "2026-10-05",
      endDate: "2026-10-08",
    });
    expect(win.id).toBe(windowId);
  });

  it("addWindow — member cannot add", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.datePoll.addWindow({
        tripId,
        id: `dw-${randomUUID().slice(0, 8)}`,
        startDate: "2026-11-01",
        endDate: "2026-11-04",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("vote — member can vote", async () => {
    const caller = createTestCaller(memberId);
    const vote = await caller.datePoll.vote({
      tripId,
      windowId,
      answer: "yes",
    });
    expect(vote.answer).toBe("yes");
  });

  it("get — returns windows with votes", async () => {
    const caller = createTestCaller(memberId);
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.windows.length).toBe(1);
    expect(poll.windows[0].votes.length).toBe(1);
  });

  it("lockWindow — owner can lock a window", async () => {
    const caller = createTestCaller(ownerId);
    const trip = await caller.datePoll.lockWindow({ tripId, windowId });
    expect(trip.start_date).toBe("2026-10-05");
    expect(trip.end_date).toBe("2026-10-08");
  });

  it("unlock — owner can unlock dates", async () => {
    const caller = createTestCaller(ownerId);
    const trip = await caller.datePoll.unlock({ tripId });
    expect(trip.start_date).toBeNull();
  });
});
