import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * matchOutcomes router (Refactor B2). B2 permission scope is ELEVATED TIER ONLY
 * (owner/organizer/delegate), matching migration 075's RLS write policy exactly
 * — the member-tier widening is B3's job (both the mutation AND RLS together).
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let owner: string, member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Outcome Router Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

async function freshOutcomeMatch(name: string): Promise<{ gameId: string; matchId: string }> {
  const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name });
  const gameId = game.id as string;
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
  const matches = await ctx.caller().matches.setPairings({
    tripId, gameId,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
  });
  const matchId = (matches as { id: string }[])[0].id;
  await ctx.caller().games.enableScoring({ tripId, gameId });
  return { gameId, matchId };
}

describe("matchOutcomes.upsertOutcome — elevated tier only (B2 scope)", () => {
  it("Owner records a hole outcome; it persists and round-trips via listByGame", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Owner Writes");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 1, result: "side_a" }]);
  });

  it("Organizer (delegate-equivalent elevated tier) may also write", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Organizer Writes");
    await ctx.callerAs("planner").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 2, result: "halved" });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 2, result: "halved" }]);
  });

  it("a plain Member is REJECTED (B2 scope — widened in B3)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Member Blocked");
    await expect(
      ctx.callerAs("member").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" })
    ).rejects.toThrow();
  });

  it("is idempotent on (match_id, hole_number) — a re-tap UPDATES the same row, not a duplicate", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Idempotent");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "halved" });
    const { data } = await ctx.admin.from("match_hole_outcomes").select("result").eq("match_id", matchId).eq("hole_number", 1);
    expect(data).toHaveLength(1);
    expect((data as { result: string }[])[0].result).toBe("halved");
  });

  it("rejects a write once scoring hasn't been enabled yet", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Not Enabled" });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await expect(
      ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" })
    ).rejects.toThrow(/enable scoring/i);
  });
});

describe("matchOutcomes.deleteOutcome — Reset hole", () => {
  it("clears a recorded outcome back to undecided", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Hole");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });

  it("a plain Member is REJECTED (same B2 scope as upsert)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Blocked");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await expect(
      ctx.callerAs("member").matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 })
    ).rejects.toThrow();
  });
});

describe("matchOutcomes.listByGame — read parity with scores.listByGame", () => {
  it("a plain Member CAN read (read is not the elevated-tier concern)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Member Reads");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    const rows = await ctx.callerAs("member").matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 1, result: "side_a" }]);
  });

  it("a Member sees nothing for a SETUP-mode (pending) game they can't edit", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Still Pending" });
    const gameId = game.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const rows = await ctx.callerAs("member").matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });
});
