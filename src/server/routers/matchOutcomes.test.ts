import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * matchOutcomes router. B3 widened the write permission to the SCOPED model
 * (matching `scores.ts` exactly): owner/organizer/delegate → any match; a
 * plain member → only the match they're playing in (`canWriteOutcome` →
 * `memberCanScoreUnit`); a non-participant member → nothing. Landed together
 * with migration 076's `can_score_match` RLS policy (see that migration's
 * comment for why the two layers can't ship separately).
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
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

/** owner (side A) vs member (side B) — outsider is a trip member but plays no
 *  part in this match, the genuine "not authorized" case. */
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

describe("matchOutcomes.upsertOutcome — scoped permissions (B3)", () => {
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

  it("B3: a member IN the match may record its outcome (their own match)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Member In Match");
    // member is side B of this match — now authorized to decide its holes.
    await ctx.callerAs("member").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_b" });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([{ match_id: matchId, hole_number: 1, result: "side_b" }]);
  });

  it("a member NOT in the match is still REJECTED (genuine non-participant)", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Outsider Blocked");
    await expect(
      ctx.callerAs("outsider").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" })
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

describe("matchOutcomes.deleteOutcome — Reset hole (same scoped permissions)", () => {
  it("clears a recorded outcome back to undecided", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Hole");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.caller().matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });

  it("B3: a member IN the match may reset its own hole", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Own Match");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await ctx.callerAs("member").matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 });
    const rows = await ctx.caller().matchOutcomes.listByGame({ tripId, gameId });
    expect(rows).toEqual([]);
  });

  it("a member NOT in the match is still REJECTED", async () => {
    const { gameId, matchId } = await freshOutcomeMatch("Reset Outsider Blocked");
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 1, result: "side_a" });
    await expect(
      ctx.callerAs("outsider").matchOutcomes.deleteOutcome({ tripId, gameId, matchId, holeNumber: 1 })
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
