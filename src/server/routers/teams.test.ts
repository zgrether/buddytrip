import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("teams router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-teams-${randomUUID().slice(0, 8)}`;
  const eventId = `evt-${randomUUID().slice(0, 8)}`;
  const teamId = `team-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Teams Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
    await admin.from("events").insert({
      id: eventId,
      trip_id: tripId,
      title: "BBMI",
      location: "Bandon",
      dates: "Oct 2026",
    });
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("teams").delete().eq("event_id", eventId);
    await admin.from("events").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("upsert — owner can create a team", async () => {
    const caller = createTestCaller(ownerId);
    const team = await caller.teams.upsert({
      tripId,
      id: teamId,
      eventId,
      name: "Team Hammer",
      shortName: "HAMMER",
      color: "#00e676",
      colorDim: "#00e67640",
    });
    expect(team.name).toBe("Team Hammer");
  });

  it("list — member can view teams", async () => {
    const caller = createTestCaller(memberId);
    const teams = await caller.teams.list({ tripId, eventId });
    expect(teams.length).toBeGreaterThanOrEqual(1);
  });
});
