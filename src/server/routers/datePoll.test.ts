import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE POLL IT USES (#1527). This file used to share one trip,
 * its two windows and the member's votes across every case — "unlock preserves
 * votes" even relied on the member having "voted 'no' earlier in the suite" — so
 * a failure in one case failed the next as if behaviour broke, and the refusal
 * cases could pass against windows that were never created. Shuffled order
 * surfaced 8 such dependencies.
 *
 * `pollTrip()` builds a trip with the crew and two windows; every refusal and
 * absence first asserts the thing it is about exists.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

/** A trip with member + Organizer and two date windows (Oct and Nov). */
async function pollTrip(label: string) {
  const tripId = await ctx.createTrip(`Poll ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  const w1 = await ctx.caller().datePoll.addWindow({ tripId, id: genId("dw"), startDate: "2026-10-05", endDate: "2026-10-08" });
  const w2 = await ctx.caller().datePoll.addWindow({ tripId, id: genId("dw"), startDate: "2026-11-10", endDate: "2026-11-14" });
  return { tripId, w1: w1.id as string, w2: w2.id as string };
}

async function memberVote(tripId: string, windowId: string) {
  const poll = await ctx.caller().datePoll.get({ tripId });
  const memberId = ctx.getUser("member").id;
  return poll.windows.find((w) => w.id === windowId)?.votes.find((v) => v.user_id === memberId);
}

describe("datePoll router — windows", () => {
  it("addWindow — owner can add a date window, and it is in the poll", async () => {
    const tripId = await ctx.createTrip("Poll add");
    const win = await ctx.caller().datePoll.addWindow({ tripId, id: genId("dw"), startDate: "2026-10-05", endDate: "2026-10-08" });
    const poll = await ctx.caller().datePoll.get({ tripId });
    expect(poll.windows.map((w) => w.id)).toEqual([win.id]);
  });

  it("addWindow — member cannot add, and no window appears", async () => {
    const { tripId } = await pollTrip("add-member");
    expect((await ctx.caller().datePoll.get({ tripId })).windows).toHaveLength(2); // premise
    await expect(
      ctx.callerAs("member").datePoll.addWindow({ tripId, id: genId("dw"), startDate: "2026-11-01", endDate: "2026-11-04" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ctx.caller().datePoll.get({ tripId })).windows).toHaveLength(2);
  });

  it("get — returns windows with votes and lockedWindowId", async () => {
    const { tripId } = await pollTrip("get");
    const poll = await ctx.callerAs("member").datePoll.get({ tripId });
    expect(poll.windows.length).toBe(2);
    expect(poll.lockedWindowId).toBeNull();
  });

  it("removeWindow — owner can remove a window (votes cascade)", async () => {
    const { tripId } = await pollTrip("remove-owner");
    const removeId = genId("dw");
    await ctx.caller().datePoll.addWindow({ tripId, id: removeId, startDate: "2026-12-01", endDate: "2026-12-05" });
    await ctx.caller().datePoll.castDateVote({ tripId, windowId: removeId, answer: "yes" });
    expect((await ctx.caller().datePoll.get({ tripId })).windows.some((w) => w.id === removeId)).toBe(true); // premise

    const result = await ctx.caller().datePoll.removeWindow({ tripId, windowId: removeId });
    expect(result.success).toBe(true);
    const poll = await ctx.caller().datePoll.get({ tripId });
    expect(poll.windows.find((w) => w.id === removeId)).toBeUndefined();
    expect(poll.windows).toHaveLength(2); // CONTROL: only that window went
    const { count } = await ctx.admin.from("date_poll_votes").select("window_id", { count: "exact", head: true }).eq("window_id", removeId);
    expect(count).toBe(0);
  });

  it("removeWindow — planner can remove a window", async () => {
    const { tripId, w2 } = await pollTrip("remove-organizer");
    const result = await ctx.callerAs("planner").datePoll.removeWindow({ tripId, windowId: w2 });
    expect(result.success).toBe(true);
    expect((await ctx.caller().datePoll.get({ tripId })).windows.some((w) => w.id === w2)).toBe(false);
  });

  it("removeWindow — member cannot remove a window, and it stays", async () => {
    const { tripId, w1 } = await pollTrip("remove-member");
    await expect(
      ctx.callerAs("member").datePoll.removeWindow({ tripId, windowId: w1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ctx.caller().datePoll.get({ tripId })).windows.some((w) => w.id === w1)).toBe(true);
  });
});

describe("datePoll router — votes", () => {
  it("vote — member can vote yes", async () => {
    const { tripId, w1 } = await pollTrip("vote-yes");
    const vote = await ctx.callerAs("member").datePoll.castDateVote({ tripId, windowId: w1, answer: "yes" });
    expect(vote.answer).toBe("yes");
    expect((await memberVote(tripId, w1))?.answer).toBe("yes");
  });

  it("vote — member can vote maybe", async () => {
    const { tripId, w2 } = await pollTrip("vote-maybe");
    const vote = await ctx.callerAs("member").datePoll.castDateVote({ tripId, windowId: w2, answer: "maybe" });
    expect(vote.answer).toBe("maybe");
  });

  it("vote — toggle off: the same answer again deletes the vote", async () => {
    const { tripId, w1 } = await pollTrip("vote-toggle");
    const member = ctx.callerAs("member");
    await member.datePoll.castDateVote({ tripId, windowId: w1, answer: "yes" });
    expect((await memberVote(tripId, w1))?.answer).toBe("yes"); // premise: there IS a vote to toggle off

    const result = await member.datePoll.castDateVote({ tripId, windowId: w1, answer: "yes" });
    expect(result.deleted).toBe(true);
    expect(result.answer).toBeNull();
    expect(await memberVote(tripId, w1)).toBeUndefined();
    // CONTROL: the window itself is still there — only the vote went.
    expect((await ctx.caller().datePoll.get({ tripId })).windows.some((w) => w.id === w1)).toBe(true);
  });

  it("vote — switching answer updates without deleting", async () => {
    const { tripId, w1 } = await pollTrip("vote-switch");
    const member = ctx.callerAs("member");
    await member.datePoll.castDateVote({ tripId, windowId: w1, answer: "yes" });
    const result = await member.datePoll.castDateVote({ tripId, windowId: w1, answer: "no" });
    expect(result.answer).toBe("no");
    expect((await memberVote(tripId, w1))?.answer).toBe("no");
  });
});

describe("datePoll router — lock, unlock, return to poll", () => {
  it("lockWindow — owner can lock and writes locked_window_id", async () => {
    const { tripId, w1 } = await pollTrip("lock");
    const trip = await ctx.caller().datePoll.lockDateWindow({ tripId, windowId: w1 });
    expect(trip.start_date).toBe("2026-10-05");
    expect(trip.end_date).toBe("2026-10-08");
    expect((await ctx.caller().datePoll.get({ tripId })).lockedWindowId).toBe(w1);
  });

  it("unlock — owner can unlock and clears locked_window_id", async () => {
    const { tripId, w1 } = await pollTrip("unlock");
    await ctx.caller().datePoll.lockDateWindow({ tripId, windowId: w1 });
    expect((await ctx.caller().datePoll.get({ tripId })).lockedWindowId).toBe(w1); // premise: locked

    const trip = await ctx.caller().datePoll.unlock({ tripId });
    expect(trip.start_date).toBeNull();
    expect(trip.end_date).toBeNull();
    expect((await ctx.caller().datePoll.get({ tripId })).lockedWindowId).toBeNull();
  });

  it("unlock — date windows and votes are preserved after unlock", async () => {
    const { tripId, w1 } = await pollTrip("unlock-keeps");
    await ctx.callerAs("member").datePoll.castDateVote({ tripId, windowId: w1, answer: "no" });
    expect((await memberVote(tripId, w1))?.answer).toBe("no"); // premise: a vote to preserve

    await ctx.caller().datePoll.lockDateWindow({ tripId, windowId: w1 });
    await ctx.caller().datePoll.unlock({ tripId });

    const poll = await ctx.caller().datePoll.get({ tripId });
    expect(poll.windows.length).toBe(2);
    expect((await memberVote(tripId, w1))?.answer).toBe("no");
  });

  it("unlock — deletes direct-set window (no votes) so UI reverts to date picker", async () => {
    const directTripId = await ctx.createTrip("Direct Lock Test");
    const caller = ctx.caller();
    await caller.trips.lockDates({ tripId: directTripId, startDate: "2026-09-01", endDate: "2026-09-05" });

    let poll = await caller.datePoll.get({ tripId: directTripId });
    expect(poll.windows.length).toBe(1); // premise

    await caller.datePoll.unlock({ tripId: directTripId });
    poll = await caller.datePoll.get({ tripId: directTripId });
    expect(poll.windows.length).toBe(0);
    expect(poll.lockedWindowId).toBeNull();
  });

  it("unlock — member cannot unlock, and the lock holds", async () => {
    const { tripId, w1 } = await pollTrip("unlock-member");
    await ctx.caller().datePoll.lockDateWindow({ tripId, windowId: w1 });
    await expect(ctx.callerAs("member").datePoll.unlock({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ctx.caller().datePoll.get({ tripId })).lockedWindowId).toBe(w1);
  });

  it("returnToPoll — preserves all windows and votes (even the locked one with zero votes)", async () => {
    // Direct-lock creates a single window with no votes, so this proves
    // returnToPoll does NOT delete it the way unlock would.
    const rtTripId = await ctx.createTrip("Return To Poll Test");
    const caller = ctx.caller();
    await caller.trips.lockDates({ tripId: rtTripId, startDate: "2026-09-01", endDate: "2026-09-05" });

    let poll = await caller.datePoll.get({ tripId: rtTripId });
    expect(poll.windows.length).toBe(1); // premise
    const directWindowId = poll.windows[0]!.id;

    await caller.datePoll.returnToPoll({ tripId: rtTripId });

    poll = await caller.datePoll.get({ tripId: rtTripId });
    expect(poll.windows.length).toBe(1);
    expect(poll.windows[0]!.id).toBe(directWindowId);
    expect(poll.lockedWindowId).toBeNull();
    expect(poll.pollMode).toBe(true);

    const trip = await caller.trips.getById({ tripId: rtTripId });
    expect(trip.start_date).toBeNull();
    expect(trip.end_date).toBeNull();
  });

  it("returnToPoll — preserves votes on the windows", async () => {
    const { tripId, w1 } = await pollTrip("return-votes");
    await ctx.callerAs("member").datePoll.castDateVote({ tripId, windowId: w1, answer: "yes" });
    expect((await memberVote(tripId, w1))?.answer).toBe("yes"); // premise

    await ctx.caller().datePoll.lockDateWindow({ tripId, windowId: w1 });
    await ctx.caller().datePoll.returnToPoll({ tripId });

    const poll = await ctx.caller().datePoll.get({ tripId });
    expect((await memberVote(tripId, w1))?.answer).toBe("yes");
    expect(poll.pollMode).toBe(true);
    expect(poll.lockedWindowId).toBeNull();
  });

  it("returnToPoll — member cannot call, and the lock holds", async () => {
    const { tripId, w1 } = await pollTrip("return-member");
    await ctx.caller().datePoll.lockDateWindow({ tripId, windowId: w1 });
    await expect(ctx.callerAs("member").datePoll.returnToPoll({ tripId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ctx.caller().datePoll.get({ tripId })).lockedWindowId).toBe(w1);
  });
});
