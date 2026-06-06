import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, createAnonCaller } from "../__tests__/helpers/test-setup";

let ctx: TestContext;

describe("tRPC middleware", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("authedProcedure: allows authenticated users", async () => {
    const caller = ctx.caller();
    const me = await caller.users.getMe();
    expect(me.id).toBe(ctx.user.id);
  });

  it("authedProcedure: rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = createAnonCaller();
    await expect(caller.users.getMe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
