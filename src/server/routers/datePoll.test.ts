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
    await ctx.addTripMember(tripId, "planner", "Organizer");
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
    const vote = await caller.datePoll.castDateVote({
      tripId,
      windowId,
      answer: "yes",
    });
    expect(vote.answer).toBe("yes");
  });

  it("vote — member can vote maybe", async () => {
    const caller = ctx.callerAs("member");
    const vote = await caller.datePoll.castDateVote({
      tripId,
      windowId: window2Id,
      answer: "maybe",
    });
    expect(vote.answer).toBe("maybe");
  });

  it("vote — toggle off: same answer deletes vote", async () => {
    const caller = ctx.callerAs("member");
    // Vote 'yes' on windowId again (already voted 'yes')
    const result = await caller.datePoll.castDateVote({
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
    await caller.datePoll.castDateVote({ tripId, windowId, answer: "yes" });
    // Then switch to no
    const result = await caller.datePoll.castDateVote({ tripId, windowId, answer: "no" });
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
    const trip = await caller.datePoll.lockDateWindow({ tripId, windowId });
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
    expect(trip.end_date).toBeNull();

    // Verify locked_window_id is cleared
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.lockedWindowId).toBeNull();
  });

  it("unlock — date windows and votes are preserved after unlock", async () => {
    // Lock then unlock again
    const caller = ctx.caller();
    await caller.datePoll.lockDateWindow({ tripId, windowId });
    await caller.datePoll.unlock({ tripId });

    const poll = await caller.datePoll.get({ tripId });
    // Both windows still exist
    expect(poll.windows.length).toBe(2);
    // Votes on window1 are still there (member voted "no" earlier in the suite)
    const win1 = poll.windows.find((w) => w.id === windowId);
    expect(win1?.votes.length).toBeGreaterThan(0);
  });

  it("unlock — deletes direct-set window (no votes) so UI reverts to date picker", async () => {
    // Create a fresh trip and lock dates directly (no poll, no votes)
    const directTripId = await ctx.createTrip("Direct Lock Test");
    const caller = ctx.caller();

    await caller.trips.lockDates({
      tripId: directTripId,
      startDate: "2026-09-01",
      endDate: "2026-09-05",
    });

    // Verify the window was created
    let poll = await caller.datePoll.get({ tripId: directTripId });
    expect(poll.windows.length).toBe(1);

    // Unlock — window has no votes so it should be deleted
    await caller.datePoll.unlock({ tripId: directTripId });

    poll = await caller.datePoll.get({ tripId: directTripId });
    expect(poll.windows.length).toBe(0);
    expect(poll.lockedWindowId).toBeNull();
  });

  it("unlock — member cannot unlock", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.datePoll.unlock({ tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── removeWindow ────────────────────────────────────────────────────────

  it("removeWindow — owner can remove a window (votes cascade)", async () => {
    const caller = ctx.caller();
    // Add a window and cast a vote on it
    const removeId = genId("dw");
    await caller.datePoll.addWindow({ tripId, id: removeId, startDate: "2026-12-01", endDate: "2026-12-05" });
    await caller.datePoll.castDateVote({ tripId, windowId: removeId, answer: "yes" });

    const result = await caller.datePoll.removeWindow({ tripId, windowId: removeId });
    expect(result.success).toBe(true);

    // Confirm the window no longer appears in the poll
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.windows.find((w) => w.id === removeId)).toBeUndefined();
  });

  it("removeWindow — planner can remove a window", async () => {
    const caller = ctx.callerAs("planner");
    const removeId = genId("dw");
    await ctx.caller().datePoll.addWindow({ tripId, id: removeId, startDate: "2026-12-10", endDate: "2026-12-14" });
    const result = await caller.datePoll.removeWindow({ tripId, windowId: removeId });
    expect(result.success).toBe(true);
  });

  it("removeWindow — member cannot remove a window", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.datePoll.removeWindow({ tripId, windowId: windowId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── returnToPoll ────────────────────────────────────────────────────────

  it("returnToPoll — preserves all windows and votes (even the locked one with zero votes)", async () => {
    // Fresh trip + direct-lock (creates a single window with no votes) so we
    // can prove returnToPoll does NOT delete it the way unlock would.
    const rtTripId = await ctx.createTrip("Return To Poll Test");
    const caller = ctx.caller();

    await caller.trips.lockDates({
      tripId: rtTripId,
      startDate: "2026-09-01",
      endDate: "2026-09-05",
    });

    // Confirm the window was created and dates are locked
    let poll = await caller.datePoll.get({ tripId: rtTripId });
    expect(poll.windows.length).toBe(1);
    const directWindowId = poll.windows[0]!.id;

    await caller.datePoll.returnToPoll({ tripId: rtTripId });

    // Window should still be there (unlock would have deleted it)
    poll = await caller.datePoll.get({ tripId: rtTripId });
    expect(poll.windows.length).toBe(1);
    expect(poll.windows[0]!.id).toBe(directWindowId);
    expect(poll.lockedWindowId).toBeNull();
    expect(poll.pollMode).toBe(true);

    // Trip dates should be cleared
    const trip = await caller.trips.getById({ tripId: rtTripId });
    expect(trip.start_date).toBeNull();
    expect(trip.end_date).toBeNull();
  });

  it("returnToPoll — preserves votes on non-locked windows", async () => {
    // Use the main suite trip which has windows + votes from earlier tests.
    const ownerCaller = ctx.caller();
    const memberCaller = ctx.callerAs("member");

    // Ensure at least one vote exists
    await memberCaller.datePoll.castDateVote({ tripId, windowId, answer: "yes" });

    // Lock then return to poll
    await ownerCaller.datePoll.lockDateWindow({ tripId, windowId });
    await ownerCaller.datePoll.returnToPoll({ tripId });

    const poll = await ownerCaller.datePoll.get({ tripId });
    const win = poll.windows.find((w) => w.id === windowId);
    const memberUser = ctx.getUser("member");
    const memberVote = win?.votes.find((v) => v.user_id === memberUser.id);
    expect(memberVote?.answer).toBe("yes");
    expect(poll.pollMode).toBe(true);
    expect(poll.lockedWindowId).toBeNull();
  });

  it("returnToPoll — member cannot call", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.datePoll.returnToPoll({ tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
