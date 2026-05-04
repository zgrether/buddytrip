import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { TRPCError } from "@trpc/server";

/**
 * groupResults is STUBBED in Phase A — Phase B rebuilds the full scoring
 * surface. These tests exist to confirm the stubs return the expected
 * empty shapes and that mutations throw NOT_IMPLEMENTED so callers fail
 * loudly rather than silently corrupting data.
 */

let ctx: TestContext;
let tripId: string;

describe("groupResults router (stubbed in Phase A)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("groupResults stub test");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("list — returns empty array", async () => {
    const caller = ctx.caller();
    const result = await caller.groupResults.list({ tripId });
    expect(result).toEqual([]);
  });

  it("listScoresByEvent — returns empty array", async () => {
    const caller = ctx.caller();
    const result = await caller.groupResults.listScoresByEvent({ tripId });
    expect(result).toEqual([]);
  });

  it("listScoresForRound — returns empty array", async () => {
    const caller = ctx.caller();
    const result = await caller.groupResults.listScoresForRound({ tripId });
    expect(result).toEqual([]);
  });

  it("submit — throws NOT_IMPLEMENTED", async () => {
    const caller = ctx.caller();
    await expect(
      caller.groupResults.submit({ tripId, scores: [] })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
