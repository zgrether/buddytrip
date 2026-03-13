import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * groupResults router — integration tests with authenticated clients.
 *
 * Tests verify that:
 *   - Any trip member can submit scores (INSERT into group_results + group_result_scores)
 *   - Any trip member can view results
 *   - Upsert is idempotent (delete old scores, insert new)
 */

let ctx: TestContext;
let tripId: string;
let eventId: string;
let roundId: string;
let groupId: string;

describe("groupResults router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    const member = ctx.getUser("member");

    tripId = await ctx.createTrip("Results Test");
    await ctx.addTripMember(tripId, "member", "Member");

    eventId = await ctx.createEvent(tripId, "Test Event");
    roundId = await ctx.createRound(eventId);
    groupId = await ctx.createPlayGroup(eventId, [ctx.user.id, member.id]);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("submit — any member can submit a result with scores", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.groupResults.submit({
      tripId,
      roundId,
      groupId,
      eventId,
      scores: [
        { teamId: "team-a", points: 1 },
        { teamId: "team-b", points: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("list — member can view results", async () => {
    const caller = ctx.callerAs("member");
    const results = await caller.groupResults.list({ tripId, roundId });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("submit — idempotent (upsert with new scores)", async () => {
    const caller = ctx.caller();
    const result = await caller.groupResults.submit({
      tripId,
      roundId,
      groupId,
      eventId,
      scores: [
        { teamId: "team-a", points: 0.5 },
        { teamId: "team-b", points: 0.5 },
      ],
    });
    expect(result.success).toBe(true);
  });
});
