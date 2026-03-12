import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  createTestCaller,
  createAnonCaller,
  getAdminClient,
  hasServiceKey,
  cleanupRows,
} from "../test-helpers";

const skip = !hasServiceKey();

describe.skipIf(skip)("users router", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    const admin = getAdminClient();
    // Seed a user row
    await admin.from("users").upsert({
      id: userId,
      name: "Test User",
      nickname: "Tester",
      email: `test-${userId}@example.com`,
    });
  });

  afterAll(async () => {
    await cleanupRows("users", "id", [userId]);
  });

  // -------------------------------------------------------------------------
  // getMe
  // -------------------------------------------------------------------------
  it("getMe returns the current user's profile", async () => {
    const caller = createTestCaller(userId);
    const user = await caller.users.getMe();
    expect(user.id).toBe(userId);
    expect(user.name).toBe("Test User");
    expect(user.nickname).toBe("Tester");
    expect(user.email).toBe(`test-${userId}@example.com`);
  });

  it("getMe throws UNAUTHORIZED for anonymous callers", async () => {
    const caller = createAnonCaller();
    await expect(caller.users.getMe()).rejects.toThrow("UNAUTHORIZED");
  });

  // -------------------------------------------------------------------------
  // updateMe
  // -------------------------------------------------------------------------
  it("updateMe updates name", async () => {
    const caller = createTestCaller(userId);
    const updated = await caller.users.updateMe({ name: "New Name" });
    expect(updated.name).toBe("New Name");
    expect(updated.nickname).toBe("Tester"); // unchanged
  });

  it("updateMe updates nickname", async () => {
    const caller = createTestCaller(userId);
    const updated = await caller.users.updateMe({ nickname: "Newbie" });
    expect(updated.nickname).toBe("Newbie");
  });

  it("updateMe throws BAD_REQUEST when no fields provided", async () => {
    const caller = createTestCaller(userId);
    await expect(caller.users.updateMe({})).rejects.toThrow("BAD_REQUEST");
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------
  it("search finds users by email", async () => {
    const caller = createTestCaller(userId);
    const results = await caller.users.search({
      query: `test-${userId}`,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(userId);
  });

  it("search returns empty for no matches", async () => {
    const caller = createTestCaller(userId);
    const results = await caller.users.search({
      query: "nonexistent-xyz-999@example.com",
    });
    expect(results).toEqual([]);
  });
});
