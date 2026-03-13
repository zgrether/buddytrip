import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let windowId: string;

describe("datePoll router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Poll Test");
    await ctx.addTripMember(tripId, "member", "Member");
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

  it("vote — member can vote", async () => {
    const caller = ctx.callerAs("member");
    const vote = await caller.datePoll.vote({
      tripId,
      windowId,
      answer: "yes",
    });
    expect(vote.answer).toBe("yes");
  });

  it("get — returns windows with votes", async () => {
    const caller = ctx.callerAs("member");
    const poll = await caller.datePoll.get({ tripId });
    expect(poll.windows.length).toBe(1);
    expect(poll.windows[0].votes.length).toBe(1);
  });

  it("lockWindow — owner can lock a window", async () => {
    const caller = ctx.caller();
    const trip = await caller.datePoll.lockWindow({ tripId, windowId });
    expect(trip.start_date).toBe("2026-10-05");
    expect(trip.end_date).toBe("2026-10-08");
  });

  it("unlock — owner can unlock dates", async () => {
    const caller = ctx.caller();
    const trip = await caller.datePoll.unlock({ tripId });
    expect(trip.start_date).toBeNull();
  });
});
