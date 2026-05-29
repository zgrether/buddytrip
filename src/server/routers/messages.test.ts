import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("messages router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Messages Test");
    await ctx.addTripMember(tripId, "planner", "Planner");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  }, 30000); // cleanup does many sequential remote deletes per trip; this suite
  // creates a dozen-plus trips, so the default 10s hook timeout is too tight.

  it("send — member can send a trip message", async () => {
    const caller = ctx.callerAs("member");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      text: "Hello everyone!",
    });
    expect(msg.text).toBe("Hello everyone!");
    expect(msg.channel).toBe("trip");
    expect(msg.visibility).toBe("crew");
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

  // ── Crew / Organizers visibility split ─────────────────────────────────

  it("send — owner can post to the Organizers (planning) channel", async () => {
    const caller = ctx.caller();
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      visibility: "planning",
      text: "Organizers only",
    });
    expect(msg.visibility).toBe("planning");
  });

  it("send — planner can post to the Organizers channel", async () => {
    const caller = ctx.callerAs("planner");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      visibility: "planning",
      text: "Planner planning note",
    });
    expect(msg.visibility).toBe("planning");
  });

  it("send — member cannot post to the Organizers channel", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.send({
        tripId,
        id: genId("msg"),
        visibility: "planning",
        text: "I should not be able to do this",
      })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  it("list — owner sees planning messages on the planning channel", async () => {
    const caller = ctx.caller();
    const msgs = await caller.messages.list({ tripId, visibility: "planning" });
    expect(msgs.some((m) => m.text === "Organizers only")).toBe(true);
  });

  it("list — crew channel excludes planning messages", async () => {
    const caller = ctx.caller();
    const msgs = await caller.messages.list({ tripId, visibility: "crew" });
    expect(msgs.every((m) => m.visibility === "crew")).toBe(true);
    expect(msgs.some((m) => m.text === "Organizers only")).toBe(false);
  });

  it("list — member cannot read the Organizers channel", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.list({ tripId, visibility: "planning" })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  // ── Read state — server-backed, cross-device ───────────────────────────

  it("readState — defaults to null on both channels before anything is read", async () => {
    const trip = await ctx.createTrip("Read State Defaults");
    const msgs = await ctx.caller().messages.readState({ tripId: trip });
    expect(msgs.crew).toBeNull();
    expect(msgs.planning).toBeNull();
  });

  it("markRead — records the caller's crew read timestamp", async () => {
    const trip = await ctx.createTrip("Mark Read Crew");
    const owner = ctx.caller();
    const res = await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(typeof res.last_read_at).toBe("string");

    const state = await owner.messages.readState({ tripId: trip });
    expect(state.crew).toBe(res.last_read_at);
    expect(state.planning).toBeNull();
  });

  it("markRead — is idempotent and advances the timestamp on re-read", async () => {
    const trip = await ctx.createTrip("Mark Read Advance");
    const owner = ctx.caller();
    const first = await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(new Date(second.last_read_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.last_read_at).getTime()
    );

    const state = await owner.messages.readState({ tripId: trip });
    expect(state.crew).toBe(second.last_read_at);
  });

  it("markRead — member cannot mark the Organizers channel read", async () => {
    const trip = await ctx.createTrip("Mark Read Guard");
    await ctx.addTripMember(trip, "member", "Member");
    await expect(
      ctx.callerAs("member").messages.markRead({ tripId: trip, visibility: "planning" })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  it("readState — read marks are per-user, not shared", async () => {
    const trip = await ctx.createTrip("Read State Per User");
    await ctx.addTripMember(trip, "member", "Member");

    await ctx.caller().messages.markRead({ tripId: trip, visibility: "crew" });

    // The member never marked anything read — their state stays null even
    // though the owner just did.
    const memberState = await ctx.callerAs("member").messages.readState({ tripId: trip });
    expect(memberState.crew).toBeNull();

    const ownerState = await ctx.caller().messages.readState({ tripId: trip });
    expect(ownerState.crew).not.toBeNull();
  });

  // ── Per-member visibility floor ────────────────────────────────────────

  it("list — chat_visible_from floor hides crew history from before a member joined", async () => {
    const floorTrip = await ctx.createTrip("Floor Test");
    const owner = ctx.caller();

    // Message posted before the member is given access.
    const banter = await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      text: "Banter before you joined",
    });

    // Add member with a floor 1ms past the banter's own server timestamp.
    // Deriving the floor from created_at (server clock) rather than the
    // local clock avoids a false pass/fail when the test machine's clock
    // is skewed relative to Postgres now().
    const floor = new Date(
      new Date(banter.created_at as string).getTime() + 1
    ).toISOString();
    await ctx.admin.from("trip_members").insert({
      trip_id: floorTrip,
      user_id: ctx.getUser("member").id,
      role: "Member",
      status: "in",
      chat_visible_from: floor,
    });

    // Message posted after the member joined.
    await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      text: "Welcome aboard",
    });

    const memberView = await ctx.callerAs("member").messages.list({
      tripId: floorTrip,
    });
    expect(memberView.some((m) => m.text === "Welcome aboard")).toBe(true);
    expect(memberView.some((m) => m.text === "Banter before you joined")).toBe(
      false
    );
  });

  // ── clearChannel — owner-only privacy wipe ─────────────────────────────

  it("clearChannel — owner clears one channel without touching the other", async () => {
    const trip = await ctx.createTrip("Clear Chat Trip");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();

    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew one" });
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew two" });
    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "org secret",
    });

    const res = await owner.messages.clearChannel({ tripId: trip, visibility: "crew" });
    expect(res.deleted).toBe(2);

    // Crew is wiped except the system "cleared" marker; planning is untouched.
    const crew = await owner.messages.list({ tripId: trip, visibility: "crew" });
    expect(crew.some((m) => m.text === "crew one")).toBe(false);
    expect(crew.some((m) => m.text === "crew two")).toBe(false);
    expect(crew.every((m) => m.message_type === "system")).toBe(true);

    const planning = await owner.messages.list({ tripId: trip, visibility: "planning" });
    expect(planning.some((m) => m.text === "org secret")).toBe(true);
  });

  it("clearChannel — non-owner is forbidden", async () => {
    const trip = await ctx.createTrip("Clear Chat Guard Trip");
    await ctx.addTripMember(trip, "member", "Member");
    await ctx.callerAs("member").messages.send({
      tripId: trip,
      id: genId("msg"),
      text: "do not delete me",
    });

    await expect(
      ctx.callerAs("member").messages.clearChannel({ tripId: trip, visibility: "crew" })
    ).rejects.toThrow(/Owner/i);

    // Message survives the rejected wipe.
    const crew = await ctx.caller().messages.list({ tripId: trip, visibility: "crew" });
    expect(crew.some((m) => m.text === "do not delete me")).toBe(true);
  });

  it("list — planning_visible_from floor hides Organizers history from before promotion", async () => {
    const floorTrip = await ctx.createTrip("Planning Floor Test");
    const owner = ctx.caller();

    // Owner posts to the Organizers channel before the new organizer arrives.
    const secret = await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      visibility: "planning",
      text: "Secret organizer plan",
    });

    // Promote a member to Planner with a planning floor 1ms past the secret
    // message's own server timestamp — the same clock-skew-proof derivation
    // used by the crew-floor test (floor from created_at, not the local clock).
    const floor = new Date(
      new Date(secret.created_at as string).getTime() + 1
    ).toISOString();
    await ctx.admin.from("trip_members").insert({
      trip_id: floorTrip,
      user_id: ctx.getUser("outsider").id,
      role: "Planner",
      status: "in",
      chat_visible_from: floor,
      planning_visible_from: floor,
    });

    // Owner posts again after the promotion.
    await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      visibility: "planning",
      text: "Plan after promotion",
    });

    const promotedView = await ctx.callerAs("outsider").messages.list({
      tripId: floorTrip,
      visibility: "planning",
    });
    expect(promotedView.some((m) => m.text === "Plan after promotion")).toBe(true);
    expect(promotedView.some((m) => m.text === "Secret organizer plan")).toBe(
      false
    );
  });
});
