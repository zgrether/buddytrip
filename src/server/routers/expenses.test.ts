import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * EVERY TEST BUILDS THE EXPENSE IT USES (#1527). This file used to share one
 * expense created by the first case, and "list" read `list[0]` — whatever row
 * happened to come first — so a failure in one case failed the rest as if
 * behaviour broke, and the opt-out cases depended on each other's state.
 * Shuffled order surfaced 7 such dependencies.
 *
 * `sharedExpense()` builds a fresh trip with the member and an owner-paid
 * expense split between owner and member.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

/** A trip with the member, and a 350 expense paid by the owner, split owner + member. */
async function sharedExpense(label: string) {
  const tripId = await ctx.createTrip(`Expenses ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const member = ctx.getUser("member");
  const exp = await ctx.caller().expenses.create({
    tripId,
    id: genId("exp"),
    title: "Golf Round",
    amount: 350,
    paidByUserId: ctx.user.id,
    splitAmong: [{ userId: ctx.user.id }, { userId: member.id }],
  });
  return { tripId, expenseId: exp.id as string, memberId: member.id };
}

async function expense(tripId: string, expenseId: string) {
  const list = await ctx.caller().expenses.list({ tripId });
  return list.find((e: { id: string }) => e.id === expenseId);
}

async function split(tripId: string, expenseId: string, userId: string) {
  return (await expense(tripId, expenseId))?.splits.find((s: { user_id: string }) => s.user_id === userId);
}

describe("expenses router", () => {
  it("create — owner can create an expense", async () => {
    const { tripId, expenseId } = await sharedExpense("create-owner");
    expect((await expense(tripId, expenseId))?.title).toBe("Golf Round");
  });

  it("create — member can create", async () => {
    const tripId = await ctx.createTrip("Expenses create-member");
    await ctx.addTripMember(tripId, "member", "Member");
    const member = ctx.getUser("member");
    const exp = await ctx.callerAs("member").expenses.create({
      tripId,
      id: genId("exp"),
      title: "Member Expense",
      amount: 50,
      paidByUserId: member.id,
      splitAmong: [{ userId: member.id }, { userId: ctx.user.id }],
    });
    expect(exp.title).toBe("Member Expense");
    expect((await expense(tripId, exp.id))?.title).toBe("Member Expense");
  });

  it("list — any member can view with splits and opted_out", async () => {
    const { tripId, expenseId } = await sharedExpense("list");
    const list = await ctx.callerAs("member").expenses.list({ tripId });
    const exp = list.find((e: { id: string }) => e.id === expenseId);
    expect(exp).toBeDefined();
    expect(exp!.splits.length).toBe(2);
    // opted_out is present and defaults to false
    expect(exp!.splits.every((s: { opted_out: boolean }) => s.opted_out === false)).toBe(true);
  });

  it("updateSplits — owner can update splits", async () => {
    const { tripId, expenseId, memberId } = await sharedExpense("update-owner");
    const result = await ctx.caller().expenses.updateSplits({
      tripId,
      expenseId,
      splits: [
        { userId: ctx.user.id, amount: 200 },
        { userId: memberId, amount: 150 },
      ],
    });
    expect(result.success).toBe(true);
    expect((await split(tripId, expenseId, memberId))?.amount).toBe(150);
  });

  it("updateSplits — member cannot update splits on a receipt paid by someone else, and they are unchanged", async () => {
    const { tripId, expenseId, memberId } = await sharedExpense("update-member");
    const before = await split(tripId, expenseId, memberId);
    expect(before).toBeDefined(); // premise
    await expect(
      ctx.callerAs("member").expenses.updateSplits({ tripId, expenseId, splits: [{ userId: memberId, amount: 0 }] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await split(tripId, expenseId, memberId))?.amount).toBe(before!.amount);
  });

  it("updateSplits — a member CAN edit a receipt they paid for (title, amount, and splits)", async () => {
    const tripId = await ctx.createTrip("Expenses member-own-edit");
    await ctx.addTripMember(tripId, "member", "Member");
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

    const exp = await expense(tripId, ownExpId);
    expect(exp?.title).toBe("Fixed receipt");
    expect(exp?.amount).toBe(35);
    expect(exp?.splits.find((s: { user_id: string }) => s.user_id === member.id)?.amount).toBe(20);
  });

  it("optOut — member can opt out of an expense", async () => {
    const { tripId, expenseId, memberId } = await sharedExpense("optout");
    expect((await split(tripId, expenseId, memberId))?.opted_out).toBe(false); // premise: currently in
    const result = await ctx.callerAs("member").expenses.optOut({ tripId, expenseId, optOut: true });
    expect(result.success).toBe(true);
    const s = await split(tripId, expenseId, memberId);
    expect(s?.opted_out).toBe(true);
    expect(s?.amount).toBe(0);
  });

  it("optOut — member can rejoin an expense", async () => {
    const { tripId, expenseId, memberId } = await sharedExpense("rejoin");
    await ctx.callerAs("member").expenses.optOut({ tripId, expenseId, optOut: true });
    expect((await split(tripId, expenseId, memberId))?.opted_out).toBe(true); // premise: out before rejoining

    const result = await ctx.callerAs("member").expenses.optOut({ tripId, expenseId, optOut: false });
    expect(result.success).toBe(true);
    const s = await split(tripId, expenseId, memberId);
    expect(s?.opted_out).toBe(false);
    expect(s?.amount).toBeNull();
  });

  it("optOut — NOT_FOUND for a member who is not in the expense's split", async () => {
    const tripId = await ctx.createTrip("Expenses optout-nonparticipant");
    await ctx.addTripMember(tripId, "member", "Member");
    const soloExpId = genId("exp");
    await ctx.caller().expenses.create({
      tripId,
      id: soloExpId,
      title: "Solo expense",
      amount: 100,
      paidByUserId: ctx.user.id,
      splitAmong: [{ userId: ctx.user.id }],
    });
    // Premise: the expense exists and the member is not in its split.
    expect(await expense(tripId, soloExpId)).toBeDefined();
    expect(await split(tripId, soloExpId, ctx.getUser("member").id)).toBeUndefined();

    await expect(
      ctx.callerAs("member").expenses.optOut({ tripId, expenseId: soloExpId, optOut: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updateSplits — owner can override opt-out", async () => {
    const { tripId, expenseId, memberId } = await sharedExpense("override");
    await ctx.callerAs("member").expenses.optOut({ tripId, expenseId, optOut: true });
    expect((await split(tripId, expenseId, memberId))?.opted_out).toBe(true); // premise: opted out

    const result = await ctx.caller().expenses.updateSplits({
      tripId,
      expenseId,
      splits: [
        { userId: ctx.user.id, amount: 175 },
        { userId: memberId, amount: 175, optedOut: false },
      ],
    });
    expect(result.success).toBe(true);
    const s = await split(tripId, expenseId, memberId);
    expect(s?.opted_out).toBe(false);
    expect(s?.amount).toBe(175);
  });

  it("remove — owner can remove, and the expense is gone", async () => {
    const { tripId, expenseId } = await sharedExpense("remove-owner");
    expect(await expense(tripId, expenseId)).toBeDefined(); // premise
    const result = await ctx.caller().expenses.remove({ tripId, expenseId });
    expect(result.success).toBe(true);
    expect(await expense(tripId, expenseId)).toBeUndefined();
  });

  it("remove — a member can remove a receipt they paid for", async () => {
    const tripId = await ctx.createTrip("Expenses remove-member-own");
    await ctx.addTripMember(tripId, "member", "Member");
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
    expect(await expense(tripId, ownExpId)).toBeDefined(); // premise

    const result = await memberCaller.expenses.remove({ tripId, expenseId: ownExpId });
    expect(result.success).toBe(true);
    expect(await expense(tripId, ownExpId)).toBeUndefined();
  });

  it("remove — a member CANNOT remove a receipt paid by someone else", async () => {
    const { tripId, expenseId } = await sharedExpense("remove-member-other");
    expect(await expense(tripId, expenseId)).toBeDefined(); // premise
    await expect(
      ctx.callerAs("member").expenses.remove({ tripId, expenseId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await expense(tripId, expenseId)).toBeDefined();
  });
});
