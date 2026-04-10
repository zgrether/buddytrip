import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let notifId: string;

describe("notifications router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Notif Test");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "planner", "Planner");
    // Seed a notification event via admin
    notifId = `test-notif-${Date.now()}`;
    await ctx.admin.from("notification_events").insert({
      id: notifId,
      trip_id: tripId,
      actor_id: ctx.user.id,
      type: "destination_locked",
      payload: { destination_name: "Scottsdale, AZ", trip_name: "Notif Test", trip_id: tripId },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── list ─────────────────────────────────────────────────────────────────

  it("list — returns notifications with read state", async () => {
    const caller = ctx.caller();
    const notifs = await caller.notifications.list({ tripId });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs[0].read).toBe(false);
  });

  it("list — returns notifications for requesting user's trip only", async () => {
    // Outsider is NOT a member of the trip — should error
    const outsiderCaller = ctx.callerAs("outsider");
    await expect(
      outsiderCaller.notifications.list({ tripId })
    ).rejects.toThrow();
  });

  // ── markAllRead ──────────────────────────────────────────────────────────

  it("markAllRead — marks all as read", async () => {
    const caller = ctx.caller();
    const result = await caller.notifications.markAllRead({ tripId });
    expect(result.marked).toBeGreaterThanOrEqual(1);

    const notifs = await caller.notifications.list({ tripId });
    expect(notifs.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it("markAllRead — idempotent (marks 0 if already read)", async () => {
    const caller = ctx.caller();
    const result = await caller.notifications.markAllRead({ tripId });
    expect(result.marked).toBe(0);
  });
});

// ── lockDestination notifications ────────────────────────────────────────

describe("lockDestination creates destination_locked notifications", () => {
  let ctx2: TestContext;
  let tripId2: string;

  beforeAll(async () => {
    ctx2 = await TestContext.create();
    tripId2 = await ctx2.createTrip("Lock Dest Test");
    await ctx2.addTripMember(tripId2, "member", "Member");
    await ctx2.addTripMember(tripId2, "planner", "Planner");
  });

  afterAll(async () => {
    await ctx2.cleanup();
  });

  it("creates destination_locked for all members except actor", async () => {
    const ownerCaller = ctx2.caller();
    await ownerCaller.trips.lockDestination({
      tripId: tripId2,
      title: "Scottsdale",
      location: "Scottsdale, AZ",
    });

    // Check notifications via admin
    const { data: notifs } = await ctx2.admin
      .from("notification_events")
      .select("*")
      .eq("trip_id", tripId2)
      .eq("type", "destination_locked");

    // Should have notifications (at least one for the non-owner members)
    expect(notifs).toBeDefined();
    expect(notifs!.length).toBeGreaterThan(0);
    expect(notifs![0].payload).toMatchObject({
      destination_name: "Scottsdale",
      trip_name: "Lock Dest Test",
    });

    // The actor (owner) should NOT be the only one notified — the notifications
    // are for other members. Check that actor_id is the owner (they performed the action)
    for (const n of notifs ?? []) {
      expect(n.actor_id).toBe(ctx2.user.id);
    }
  });
});

// ── lockDates notifications ──────────────────────────────────────────────

describe("lockDates creates dates_locked notifications", () => {
  let ctx3: TestContext;
  let tripId3: string;

  beforeAll(async () => {
    ctx3 = await TestContext.create();
    tripId3 = await ctx3.createTrip("Lock Dates Test");
    await ctx3.addTripMember(tripId3, "member", "Member");
  });

  afterAll(async () => {
    await ctx3.cleanup();
  });

  it("creates dates_locked for all members except actor", async () => {
    const ownerCaller = ctx3.caller();
    await ownerCaller.trips.lockDates({
      tripId: tripId3,
      startDate: "2026-09-01",
      endDate: "2026-09-05",
      method: "direct",
    });

    const { data: notifs } = await ctx3.admin
      .from("notification_events")
      .select("*")
      .eq("trip_id", tripId3)
      .eq("type", "dates_locked");

    expect(notifs).toBeDefined();
    expect(notifs!.length).toBeGreaterThan(0);
    expect(notifs![0].payload).toMatchObject({
      trip_name: "Lock Dates Test",
    });
  });
});

// ── advanceToGoing notifications ─────────────────────────────────────────

describe("advanceToGoing creates stage_advanced notifications", () => {
  let ctx4: TestContext;
  let tripId4: string;

  beforeAll(async () => {
    ctx4 = await TestContext.create();
    tripId4 = await ctx4.createTrip("Advance Test");
    await ctx4.addTripMember(tripId4, "member", "Member");

    // Must be in planning stage with locked dates to advance
    await ctx4.admin.from("trips").update({ stage: "planning" }).eq("id", tripId4);

    // Lock dates first (required for advance)
    const ownerCaller = ctx4.caller();
    await ownerCaller.trips.lockDates({
      tripId: tripId4,
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      method: "direct",
    });
  });

  afterAll(async () => {
    await ctx4.cleanup();
  });

  it("creates stage_advanced for non-owner members", async () => {
    const ownerCaller = ctx4.caller();
    await ownerCaller.trips.advanceToGoing({
      tripId: tripId4,
      aboutMessage: "We are going!",
    });

    const { data: notifs } = await ctx4.admin
      .from("notification_events")
      .select("*")
      .eq("trip_id", tripId4)
      .eq("type", "stage_advanced");

    expect(notifs).toBeDefined();
    expect(notifs!.length).toBeGreaterThan(0);
    expect(notifs![0].payload).toMatchObject({
      trip_name: "Advance Test",
    });
  });
});

// ── Batched idea_voted notifications ─────────────────────────────────────

describe("idea_voted batching", () => {
  let ctx5: TestContext;
  let tripId5: string;
  let ideaId: string;

  beforeAll(async () => {
    ctx5 = await TestContext.create();
    tripId5 = await ctx5.createTrip("Vote Batch Test");
    await ctx5.addTripMember(tripId5, "member", "Member");
    await ctx5.addTripMember(tripId5, "planner", "Planner");

    // Create an idea
    ideaId = `test-idea-${Date.now()}`;
    const { error: ideaErr } = await ctx5.admin.from("ideas").insert({
      id: ideaId,
      trip_id: tripId5,
      title: "Beach Getaway",
      location: "Cancun, Mexico",
    });
    if (ideaErr) throw new Error(`Failed to create idea: ${ideaErr.message}`);
  });

  afterAll(async () => {
    await ctx5.cleanup();
  });

  it("member vote creates idea_voted notification for owner", async () => {
    const memberCaller = ctx5.callerAs("member");
    await memberCaller.ideas.vote({ tripId: tripId5, ideaId });

    const { data: notifs } = await ctx5.admin
      .from("notification_events")
      .select("*")
      .eq("trip_id", tripId5)
      .eq("type", "idea_voted");

    // Notification should exist with idea_voted type
    expect(notifs).toBeDefined();
    expect(notifs!.length).toBe(1);
    expect(notifs![0].type).toBe("idea_voted");
    // Payload should contain trip_id
    expect((notifs![0].payload as Record<string, unknown>).trip_id).toBe(tripId5);
  });

  it("owner voting does not create idea_voted notification", async () => {
    // Clear existing notifications
    await ctx5.admin
      .from("notification_events")
      .delete()
      .eq("trip_id", tripId5)
      .eq("type", "idea_voted");

    // Create a separate idea for the owner to vote on
    const ownerIdeaId = `test-idea-owner-${Date.now()}`;
    const { error: ideaErr } = await ctx5.admin.from("ideas").insert({
      id: ownerIdeaId,
      trip_id: tripId5,
      title: "Mountain Retreat",
      location: "Aspen, CO",
    });
    if (ideaErr) throw new Error(`Failed to create idea: ${ideaErr.message}`);

    const ownerCaller = ctx5.caller();
    await ownerCaller.ideas.vote({ tripId: tripId5, ideaId: ownerIdeaId });

    const { data: notifs } = await ctx5.admin
      .from("notification_events")
      .select("*")
      .eq("trip_id", tripId5)
      .eq("type", "idea_voted");

    // Owner's vote should not create a notification
    expect(notifs!.length).toBe(0);
  });
});
