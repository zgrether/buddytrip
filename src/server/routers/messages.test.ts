import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("messages router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Messages Test");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "planner", "Planner");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("send — member can send a trip message", async () => {
    const caller = ctx.callerAs("member");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      text: "Hello everyone!",
    });
    expect(msg.text).toBe("Hello everyone!");
    expect(msg.channel).toBe("trip");
  });

  it("list — member can view trip messages", async () => {
    const caller = ctx.callerAs("member");
    const msgs = await caller.messages.list({ tripId });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m.text === "Hello everyone!")).toBe(true);
  });

  it("send — team channel requires teamId", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.send({
        tripId,
        id: genId("msg"),
        channel: "team",
        text: "Team message",
      })
    ).rejects.toThrow("teamId is required");
  });

  // ── visibility = 'crew' vs 'planning' split (migration 004) ────────────

  it("send — default visibility is 'crew'", async () => {
    const caller = ctx.callerAs("member");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      text: "crew-default",
    });
    expect(msg.visibility).toBe("crew");
    expect(msg.message_type).toBe("user");
  });

  it("send — member is FORBIDDEN from posting to Organizers chat", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.send({
        tripId,
        id: genId("msg"),
        visibility: "planning",
        text: "should not post",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("send — planner CAN post to Organizers chat", async () => {
    const caller = ctx.callerAs("planner");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      visibility: "planning",
      text: "planning hello",
    });
    expect(msg.visibility).toBe("planning");
  });

  it("list — member is FORBIDDEN from reading Organizers chat", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.list({ tripId, visibility: "planning" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — Crew listing does not leak Organizers messages", async () => {
    const caller = ctx.callerAs("member");
    const msgs = await caller.messages.list({ tripId, visibility: "crew" });
    expect(msgs.every((m) => m.visibility === "crew")).toBe(true);
    expect(msgs.some((m) => m.text === "planning hello")).toBe(false);
  });

  it("list — Organizers listing does not leak Crew messages", async () => {
    const caller = ctx.callerAs("planner");
    const msgs = await caller.messages.list({ tripId, visibility: "planning" });
    expect(msgs.every((m) => m.visibility === "planning")).toBe(true);
    expect(msgs.some((m) => m.text === "crew-default")).toBe(false);
    expect(msgs.some((m) => m.text === "planning hello")).toBe(true);
  });

  it("list — chat_visible_from floor hides prior messages", async () => {
    // Use the "before-floor" message's own created_at as the anchor so
    // the floor lands exactly on a Postgres-stamped boundary — no JS-vs-
    // server clock skew to fight with.
    const callerMember = ctx.callerAs("member");
    const before = await callerMember.messages.send({
      tripId,
      id: genId("msg"),
      text: "before-floor",
    });
    // floor = 1ms after "before-floor" → excludes it inclusively-or-not.
    const floor = new Date(
      new Date(before.created_at).getTime() + 1
    ).toISOString();

    await ctx.admin
      .from("trip_members")
      .update({ chat_visible_from: floor })
      .eq("trip_id", tripId)
      .eq("user_id", ctx.getUser("member").id);

    // Post-floor message: the member should see this one but not "before".
    await callerMember.messages.send({
      tripId,
      id: genId("msg"),
      text: "after-floor",
    });

    const msgs = await callerMember.messages.list({ tripId });
    expect(msgs.some((m) => m.text === "after-floor")).toBe(true);
    expect(msgs.some((m) => m.text === "before-floor")).toBe(false);
  });
});
