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

  // search — email-exact only (name/nickname search was removed in favour of
  // frequentTripmates chips; non-email queries always return [])
  it("search — exact email match returns that user", async () => {
    const caller = ctx.caller(); // owner
    const planner = ctx.getUser("planner");
    const results = await caller.users.search({ query: planner.email });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(planner.id);
  });

  it("search — non-email query (no @) returns empty", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({ query: "SearchTestUser" });
    expect(results).toEqual([]);
  });

  it("search — partial email prefix (no @) returns empty", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({
      query: ctx.user.email.split("@")[0],
    });
    expect(results).toEqual([]);
  });

  it("search — unknown email returns empty", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({
      query: "nonexistent-xyz-999@example.com",
    });
    expect(results).toEqual([]);
  });

  it("search — own email returns empty (self excluded)", async () => {
    const caller = ctx.caller();
    const results = await caller.users.search({ query: ctx.user.email });
    expect(results).toEqual([]);
  });
});
