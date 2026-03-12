import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("expenses router", () => {
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const tripId = `test-exp-${randomUUID().slice(0, 8)}`;
  const expenseId = `exp-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const admin = getAdminClient();
    await admin.from("users").upsert([
      { id: ownerId, name: "Owner", nickname: "Own", email: `own-${ownerId}@test.com` },
      { id: memberId, name: "Member", nickname: "Mem", email: `mem-${memberId}@test.com` },
    ]);
    await admin.from("trips").insert({ id: tripId, title: "Expenses Test" });
    await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: ownerId, role: "Owner", status: "in" },
      { trip_id: tripId, user_id: memberId, role: "Member", status: "maybe" },
    ]);
  });

  afterAll(async () => {
    const admin = getAdminClient();
    await admin.from("expense_splits").delete().eq("expense_id", expenseId);
    await admin.from("expenses").delete().eq("trip_id", tripId);
    await admin.from("trip_members").delete().eq("trip_id", tripId);
    await cleanupRows("trips", "id", [tripId]);
    await cleanupRows("users", "id", [ownerId, memberId]);
  });

  it("create — owner can create an expense", async () => {
    const caller = createTestCaller(ownerId);
    const exp = await caller.expenses.create({
      tripId,
      id: expenseId,
      title: "Golf Round",
      amount: 350,
      paidByUserId: ownerId,
      splitAmong: [ownerId, memberId],
    });
    expect(exp.title).toBe("Golf Round");
  });

  it("create — member cannot create", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.expenses.create({
        tripId,
        id: `exp-${randomUUID().slice(0, 8)}`,
        title: "Nope",
        amount: 100,
        paidByUserId: memberId,
        splitAmong: [memberId],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("list — any member can view with splits", async () => {
    const caller = createTestCaller(memberId);
    const list = await caller.expenses.list({ tripId });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].splits.length).toBe(2);
  });

  it("updateSplits — owner can update splits", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.expenses.updateSplits({
      tripId,
      expenseId,
      splits: [
        { userId: ownerId, amount: 200 },
        { userId: memberId, amount: 150 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("updateSplits — member cannot update splits", async () => {
    const caller = createTestCaller(memberId);
    await expect(
      caller.expenses.updateSplits({
        tripId,
        expenseId,
        splits: [{ userId: memberId, amount: 0 }],
      })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("remove — owner can remove", async () => {
    const caller = createTestCaller(ownerId);
    const result = await caller.expenses.remove({ tripId, expenseId });
    expect(result.success).toBe(true);
  });
});
