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

  it("create — member can create", async () => {
    const member = ctx.getUser("member");
    const caller = ctx.callerAs("member");
    const exp = await caller.expenses.create({
      tripId,
      id: genId("exp"),
      title: "Member Expense",
      amount: 50,
      paidByUserId: member.id,
      splitAmong: [{ userId: member.id }, { userId: ctx.user.id }],
    });
    expect(exp.title).toBe("Member Expense");
    // Clean up
    await ctx.caller().expenses.remove({ tripId, expenseId: exp.id });
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

  it("updateSplits — member cannot update splits on a receipt paid by someone else", async () => {
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

  it("updateSplits — a member CAN edit a receipt they paid for (title, amount, and splits)", async () => {
    const member = ctx.getUser("member");
    const memberCaller = ctx.callerAs("member");
    const ownExpId = genId("exp");
    await memberCaller.expenses.create({
      tripId,
      id: ownExpId,
      title: "Typo'd receiptt",
      amount: 30,
      paidByUserId: member.id,
      splitAmong: [{ userId: member.id }, { userId: ctx.user.id }],
    });

    const result = await memberCaller.expenses.updateSplits({
      tripId,
      expenseId: ownExpId,
      title: "Fixed receipt",
      amount: 35,
      splits: [
        { userId: member.id, amount: 20 },
        { userId: ctx.user.id, amount: 15 },
      ],
    });
    expect(result.success).toBe(true);

    const list = await ctx.caller().expenses.list({ tripId });
    const exp = list.find((e: { id: string }) => e.id === ownExpId);
    expect(exp?.title).toBe("Fixed receipt");
    expect(exp?.amount).toBe(35);
    expect(exp?.splits.find((s: { user_id: string }) => s.user_id === member.id)?.amount).toBe(20);

    // Clean up
    await memberCaller.expenses.remove({ tripId, expenseId: ownExpId });
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

  it("remove — a member can remove a receipt they paid for", async () => {
    const member = ctx.getUser("member");
    const memberCaller = ctx.callerAs("member");
    const ownExpId = genId("exp");
    await memberCaller.expenses.create({
      tripId,
      id: ownExpId,
      title: "Member's own receipt",
      amount: 25,
      paidByUserId: member.id,
      splitAmong: [{ userId: member.id }],
    });

    const result = await memberCaller.expenses.remove({ tripId, expenseId: ownExpId });
    expect(result.success).toBe(true);

    const list = await ctx.caller().expenses.list({ tripId });
    expect(list.find((e: { id: string }) => e.id === ownExpId)).toBeUndefined();
  });

  it("remove — a member CANNOT remove a receipt paid by someone else", async () => {
    const caller = ctx.caller();
    const othersExpId = genId("exp");
    await caller.expenses.create({
      tripId,
      id: othersExpId,
      title: "Owner's receipt",
      amount: 40,
      paidByUserId: ctx.user.id,
      splitAmong: [{ userId: ctx.user.id }],
    });

    const memberCaller = ctx.callerAs("member");
    await expect(
      memberCaller.expenses.remove({ tripId, expenseId: othersExpId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Confirm it's still there, then clean up.
    const list = await caller.expenses.list({ tripId });
    expect(list.find((e: { id: string }) => e.id === othersExpId)).toBeDefined();
    await caller.expenses.remove({ tripId, expenseId: othersExpId });
  });
});
