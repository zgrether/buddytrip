import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, createAnonCaller } from "../../__tests__/helpers/test-setup";

/**
 * scoreboardShares router — integration tests with authenticated clients.
 *
 * Tests verify that:
 *   - A trip member can create a share link (RLS: trip_members check)
 *   - Creating a share is idempotent (same event → same share code)
 *   - Public getScoreboard returns event data for valid share code
 *   - Public getScoreboard throws NOT_FOUND for invalid code
 */

let ctx: TestContext;
let tripId: string;
let eventId: string;
let shareCode: string;

describe("scoreboardShares router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Share Test");
    eventId = await ctx.createEvent(tripId, "Share Event");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — generates a share code for an event", async () => {
    const caller = ctx.caller();
    const result = await caller.scoreboardShares.create({ tripId, eventId });
    expect(result.shareCode).toBeTruthy();
    expect(result.shareCode).toMatch(/^sb-/);
    shareCode = result.shareCode;
  });

  it("create — idempotent (returns same code)", async () => {
    const caller = ctx.caller();
    const result = await caller.scoreboardShares.create({ tripId, eventId });
    expect(result.shareCode).toBe(shareCode);
  });

  it("getScoreboard — returns event data for valid share code", async () => {
    // Public endpoint — use anon caller (no auth)
    const caller = createAnonCaller();
    const data = await caller.scoreboardShares.getScoreboard({ shareCode });
    expect(data.event.id).toBe(eventId);
    expect(data.tripId).toBe(tripId);
    expect(Array.isArray(data.teams)).toBe(true);
    expect(Array.isArray(data.rounds)).toBe(true);
  });

  it("getScoreboard — throws NOT_FOUND for invalid code", async () => {
    const caller = createAnonCaller();
    await expect(
      caller.scoreboardShares.getScoreboard({ shareCode: "invalid-code" })
    ).rejects.toThrow();
  });
});
