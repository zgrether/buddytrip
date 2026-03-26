import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let windowId: string;
let window2Id: string;

describe("datePoll router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Poll Test");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "planner", "Planner");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("addWindow — owner can add a date window", async () => {
    const caller = ctx.caller();
    const win = await caller.datePoll.addWindow({
      tripId,
      id: genId("dw"),
      startDate: "2026-10-05",
      endDate: "2026-10-08",
    });
    windowId = win.id;
    expect(win.id).toBeTruthy();
  });

  it("addWindow — add a second window", async () => {
    const caller = ctx.caller();
    const win = await caller.datePoll.addWindow({
      tripId,
      id: genId("dw"),
      startDate: "2026-11-10",
      endDate: "2026-11-14",
    });
    window2Id = win.id;
    expect(win.id).toBeTruthy();
  });

  it("addWindow — member cannot add", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.datePoll.addWindow({
        tripId,
        id: genId("dw"),
        startDate: "2026-11-01",
        endDate: "2026-11-04",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("vote — member can vote yes", async () => {
    const caller = ctx.callerAs("member");
    const vote = await caller.datePoll.vote({
      tripId,
      windowId,
      answer: "yes",
    });
    expect(vote.answer).toBe("yes");
  });

  it("vote — member can vote maybe", async () => {
    const caller = ctx.callerAs("member");
    const vote = await caller.datePoll.vote({
      tripId,
      windowId: window2Id,
      answer: "maybe",
    });
    expect(vote.answer).toBe("maybe");
  });

  it("vote — toggle off: same answer deletes vote", async () => {
    const caller = ctx.callerAs("member");
    // Vote 'yes' on windowId again (already voted 'yes')
    const result = await caller.datePoll.vote({
      tripId,
      windowId,
      answer: "yes",
    });
    expect(result.deleted).toBe(true);
    expect(result.answer).toBeNull();

    // Verify the vote is gone
    const poll = await caller.datePoll.get({ tripId });
    const win = poll.windows.find((w) => w.id === windowId);
    const memberUser = ctx.getUser("member");
    const myVote = win?.votes.find((v) => v.user_id === memberUser.id);
    expect(myVote).toBeUndefined();
  });

  it("vote — switching answer updates without deleting", async () => {
    const caller = ctx.callerAs("member");
    // First vote yes
    await caller.datePoll.vote({ tripId, windowId, answer: "yes" });
    // Then switch to no
    const result = await caller.datePoll.vote({ tripId, windowId, answer: "no" });
    expect(result.answer).toBe("no");

    // Verify the vote is 'no'
    const poll = await caller.datePoll.get({ tripId });
    const win = poll.windows.find((w) => w.id === windowId);
    const memberUser = ctx.getUser("member");
    const myVote = win?.votes.find((v) => v.user_id === memberUser.id);
    expect(myVote?.answer).toBe("no");
  });

  it("get — returns windows with votes and lockedWindowId", async () => {
    const caller = ctx.callerAs("member");
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.windows.length).toBe(2);
    expect(poll.lockedWindowId).toBeNull();
  });

  it("lockWindow — owner can lock and writes locked_window_id", async () => {
    const caller = ctx.caller();
    const trip = await caller.datePoll.lockWindow({ tripId, windowId });
    expect(trip.start_date).toBe("2026-10-05");
    expect(trip.end_date).toBe("2026-10-08");

    // Verify locked_window_id is set
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.lockedWindowId).toBe(windowId);
  });

  it("unlock — owner can unlock and clears locked_window_id", async () => {
    const caller = ctx.caller();
    const trip = await caller.datePoll.unlock({ tripId });
    expect(trip.start_date).toBeNull();

    // Verify locked_window_id is cleared
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.lockedWindowId).toBeNull();
  });

  it("voteOnBehalf — planner can vote for ghost member", async () => {
    // Create a ghost user
    const ghostId = genId("ghost");
    await ctx.admin.from("users").insert({
      id: ghostId,
      name: "Ghost Mike",
      is_guest: true,
      created_by: ctx.user.id,
    });
    await ctx.admin.from("trip_members").insert({
      trip_id: tripId,
      user_id: ghostId,
      role: "Member",
      status: "in",
    });

    const caller = ctx.caller();
    const result = await caller.datePoll.voteOnBehalf({
      tripId,
      userId: ghostId,
      votes: [
        { windowId, answer: "yes" },
        { windowId: window2Id, answer: "maybe" },
      ],
    });
    expect(result.success).toBe(true);

    // Verify votes are recorded
    const poll = await caller.datePoll.get({ tripId });
    const win1 = poll.windows.find((w) => w.id === windowId);
    const win2 = poll.windows.find((w) => w.id === window2Id);
    expect(win1?.votes.find((v) => v.user_id === ghostId)?.answer).toBe("yes");
    expect(win2?.votes.find((v) => v.user_id === ghostId)?.answer).toBe("maybe");

    // Clean up ghost
    await ctx.admin.from("trip_members").delete().eq("user_id", ghostId).eq("trip_id", tripId);
    await ctx.admin.from("date_poll_votes").delete().eq("user_id", ghostId);
    await ctx.admin.from("users").delete().eq("id", ghostId);
  });

  it("voteOnBehalf — cannot vote for non-ghost member", async () => {
    const caller = ctx.caller();
    const memberUser = ctx.getUser("member");
    await expect(
      caller.datePoll.voteOnBehalf({
        tripId,
        userId: memberUser.id,
        votes: [{ windowId, answer: "yes" }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("voteOnBehalf — member cannot use this procedure", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.datePoll.voteOnBehalf({
        tripId,
        userId: "some-ghost",
        votes: [{ windowId, answer: "yes" }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
