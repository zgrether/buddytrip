import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;
let expenseId: string;

describe("expenses router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Expenses Test");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — owner can create an expense", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const exp = await caller.expenses.create({
      tripId,
      id: genId("exp"),
      title: "Golf Round",
      amount: 350,
      paidByUserId: ctx.user.id,
      splitAmong: [{ userId: ctx.user.id }, { userId: member.id }],
    });
    expect(exp.title).toBe("Golf Round");
    expenseId = exp.id;
  });

  it("create — member cannot create", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("member");
    await expect(
      caller.expenses.create({
        tripId,
        id: genId("exp"),
        title: "Nope",
        amount: 100,
        paidByUserId: member.id,
        splitAmong: [{ userId: member.id }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("list — any member can view with splits", async () => {
    const caller = ctx.callerAs("member");
    const list = await caller.expenses.list({ tripId });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].splits.length).toBe(2);
  });

  it("updateSplits — owner can update splits", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const result = await caller.expenses.updateSplits({
      tripId,
      expenseId,
      splits: [
        { userId: ctx.user.id, amount: 200 },
        { userId: member.id, amount: 150 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("updateSplits — member cannot update splits", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("member");
    await expect(
      caller.expenses.updateSplits({
        tripId,
        expenseId,
        splits: [{ userId: member.id, amount: 0 }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("remove — owner can remove", async () => {
    const caller = ctx.caller();
    const result = await caller.expenses.remove({ tripId, expenseId });
    expect(result.success).toBe(true);

    // Verify the expense is actually gone (not just a silent no-op)
    const list = await caller.expenses.list({ tripId });
    expect(list.find((e: { id: string }) => e.id === expenseId)).toBeUndefined();
  });
});
