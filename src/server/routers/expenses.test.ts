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

  it("list — any member can view with splits and opted_out", async () => {
    const caller = ctx.callerAs("member");
    const list = await caller.expenses.list({ tripId });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].splits.length).toBe(2);
    // opted_out should be present and default to false
    expect(list[0].splits[0].opted_out).toBe(false);
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

  it("optOut — member can opt out of an expense", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.expenses.optOut({
      tripId,
      expenseId,
      optOut: true,
    });
    expect(result.success).toBe(true);

    // Verify opted_out and amount
    const list = await caller.expenses.list({ tripId });
    const exp = list.find((e: { id: string }) => e.id === expenseId);
    const memberSplit = exp?.splits.find(
      (s: { user_id: string }) => s.user_id === ctx.getUser("member").id
    );
    expect(memberSplit?.opted_out).toBe(true);
    expect(memberSplit?.amount).toBe(0);
  });

  it("optOut — member can rejoin an expense", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.expenses.optOut({
      tripId,
      expenseId,
      optOut: false,
    });
    expect(result.success).toBe(true);

    const list = await caller.expenses.list({ tripId });
    const exp = list.find((e: { id: string }) => e.id === expenseId);
    const memberSplit = exp?.splits.find(
      (s: { user_id: string }) => s.user_id === ctx.getUser("member").id
    );
    expect(memberSplit?.opted_out).toBe(false);
    expect(memberSplit?.amount).toBeNull();
  });

  it("optOut — NOT_FOUND for non-participant", async () => {
    // Create an expense with only the owner
    const caller = ctx.caller();
    const soloExpId = genId("exp");
    await caller.expenses.create({
      tripId,
      id: soloExpId,
      title: "Solo expense",
      amount: 100,
      paidByUserId: ctx.user.id,
      splitAmong: [{ userId: ctx.user.id }],
    });

    // Member tries to opt out but isn't in the split
    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.expenses.optOut({ tripId, expenseId: soloExpId, optOut: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Clean up
    await caller.expenses.remove({ tripId, expenseId: soloExpId });
  });

  it("updateSplits — owner can override opt-out", async () => {
    const member = ctx.getUser("member");
    const memberCaller = ctx.callerAs("member");

    // Member opts out first
    await memberCaller.expenses.optOut({ tripId, expenseId, optOut: true });

    // Owner overrides by updating splits with optedOut: false
    const caller = ctx.caller();
    const result = await caller.expenses.updateSplits({
      tripId,
      expenseId,
      splits: [
        { userId: ctx.user.id, amount: 175 },
        { userId: member.id, amount: 175, optedOut: false },
      ],
    });
    expect(result.success).toBe(true);

    // Verify member is back in
    const list = await caller.expenses.list({ tripId });
    const exp = list.find((e: { id: string }) => e.id === expenseId);
    const memberSplit = exp?.splits.find(
      (s: { user_id: string }) => s.user_id === member.id
    );
    expect(memberSplit?.opted_out).toBe(false);
    expect(memberSplit?.amount).toBe(175);
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
