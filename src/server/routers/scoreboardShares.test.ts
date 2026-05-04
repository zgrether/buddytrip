import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * scoreboardShares — Phase A keeps minting + lookup working against the
 * new schema (competition_id rather than event_id). The full leaderboard
 * payload returned by getScoreboard is a placeholder shape until Phase B
 * rebuilds scoring.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;

describe("scoreboardShares router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Share Test");
    competitionId = await ctx.createCompetition(tripId, "Share Test Cup");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("create — mints a share code for a competition", async () => {
    const caller = ctx.caller();
    const result = await caller.scoreboardShares.create({ tripId, competitionId });
    expect(typeof result.shareCode).toBe("string");
    expect(result.shareCode.length).toBeGreaterThan(0);
  });

  it("create — repeating returns the same share (idempotent per competition)", async () => {
    const caller = ctx.caller();
    const a = await caller.scoreboardShares.create({ tripId, competitionId });
    const b = await caller.scoreboardShares.create({ tripId, competitionId });
    expect(a.shareCode).toBe(b.shareCode);
  });

  it("getScoreboard — returns placeholder competition payload", async () => {
    const caller = ctx.caller();
    const { shareCode } = await caller.scoreboardShares.create({
      tripId,
      competitionId,
    });
    const result = await caller.scoreboardShares.getScoreboard({ shareCode });
    expect(result.tripId).toBe(tripId);
    expect(result.competition?.id).toBe(competitionId);
    expect(result.teams).toEqual([]);
    expect(result.events).toEqual([]);
  });
});
