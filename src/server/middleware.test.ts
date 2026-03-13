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
    const result = await caller.health();
    expect(result).toEqual({ status: "ok" });
  });

  it("authedProcedure: unauthenticated users can access public routes", async () => {
    const caller = createAnonCaller();
    const result = await caller.health();
    expect(result).toEqual({ status: "ok" });
  });
});
