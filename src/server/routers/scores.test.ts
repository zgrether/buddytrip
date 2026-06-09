import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;
let gameId: string;
let ownerId: string;
let memberId: string;

describe("scores router (Slice A — per-hole entry)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Scoring Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    const game = await ctx
      .caller()
      .games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Round" });
    gameId = game.id;
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [ownerId, memberId] });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("any member can enter a score for any participant; submitted_by is recorded", async () => {
    // The MEMBER enters a score for the OWNER's card — allowed (engine #7).
    const entry = await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 4 });
    expect(entry.value).toBe(4);
    expect(entry.participant_type).toBe("user");
    expect(entry.submitted_by).toBe(memberId); // audit only — not a gate
  });

  it("upsert updates the same cell in place (no duplicate row)", async () => {
    await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 5 });
    const updated = await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 6 });
    expect(updated.value).toBe(6);

    const { data } = await ctx.admin
      .from("score_entries")
      .select("id")
      .eq("game_id", gameId)
      .eq("participant_id", ownerId)
      .eq("unit_label", "1");
    expect(data).toHaveLength(1);
  });

  it("deleteEntry removes the cell's score", async () => {
    await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: memberId, unitLabel: "9", value: 3 });
    await ctx
      .callerAs("member")
      .scores.deleteEntry({ tripId, gameId, participantId: memberId, unitLabel: "9" });
    const { data } = await ctx.admin
      .from("score_entries")
      .select("id")
      .eq("game_id", gameId)
      .eq("participant_id", memberId)
      .eq("unit_label", "9");
    expect(data).toHaveLength(0);
  });

  it("an outsider cannot enter scores", async () => {
    await expect(
      ctx
        .callerAs("outsider")
        .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "2", value: 4 })
    ).rejects.toThrow();
  });
});
