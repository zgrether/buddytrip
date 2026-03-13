import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, createAnonCaller } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;

describe("users router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // getMe
  it("getMe returns the current user's profile", async () => {
    const caller = ctx.caller();
    const user = await caller.users.getMe();
    expect(user.id).toBe(ctx.user.id);
    expect(user.email).toBe(ctx.user.email);
  });

  it("getMe throws UNAUTHORIZED for anonymous callers", async () => {
    const caller = createAnonCaller();
    await expect(caller.users.getMe()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // updateMe
  it("updateMe updates name", async () => {
    const caller = ctx.caller();
    const updated = await caller.users.updateMe({ name: "New Name" });
    expect(updated.name).toBe("New Name");
  });

  it("updateMe updates nickname", async () => {
    const caller = ctx.caller();
    const updated = await caller.users.updateMe({ nickname: "Newbie" });
    expect(updated.nickname).toBe("Newbie");
  });

  it("updateMe throws BAD_REQUEST when no fields provided", async () => {
    const caller = ctx.caller();
    await expect(caller.users.updateMe({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // search
  it("search finds users by email", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({
      query: ctx.user.email.split("@")[0],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(ctx.user.id);
  });

  it("search returns empty for no matches", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({
      query: "nonexistent-xyz-999@example.com",
    });
    expect(results).toEqual([]);
  });
});
