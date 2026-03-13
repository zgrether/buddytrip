import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let notifId: string;

describe("notifications router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Notif Test");
    // Seed a notification event via admin
    notifId = `test-notif-${Date.now()}`;
    await ctx.admin.from("notification_events").insert({
      id: notifId,
      trip_id: tripId,
      actor_id: ctx.user.id,
      type: "destination_locked",
      payload: { destination: "Scottsdale, AZ" },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("list — returns notifications with read state", async () => {
    const caller = ctx.caller();
    const notifs = await caller.notifications.list({ tripId });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs[0].read).toBe(false);
  });

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
