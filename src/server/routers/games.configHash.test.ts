import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";

/**
 * games.configHash — the cheap cross-device change-signal (game-state sync). The
 * load-bearing properties: a CONFIG change moves the hash (so remote devices
 * refetch and converge), a SCORE entry does NOT (so scoring never triggers a
 * pointless full-config refetch), and any trip member can read it.
 */
let ctx: TestContext;
let tripId: string;
let gameId: string;
let ownerId: string;
let memberId: string;

describe("games.configHash — config change-signal", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Config Hash Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Round" });
    gameId = game.id;
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [ownerId, memberId] });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("any trip member can read the hash (a short string)", async () => {
    const { hash } = await ctx.callerAs("member").games.configHash({ tripId, gameId });
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is STABLE when nothing changes (no false 'changed')", async () => {
    const a = await ctx.caller().games.configHash({ tripId, gameId });
    const b = await ctx.caller().games.configHash({ tripId, gameId });
    expect(a.hash).toBe(b.hash);
  });

  it("CHANGES when config changes — go-live (enableScoring)", async () => {
    const before = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    await ctx.caller().games.enableScoring({ tripId, gameId });
    const after = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    expect(after).not.toBe(before);
  });

  it("does NOT change when only SCORES change (the efficiency guarantee)", async () => {
    // Scoring is enabled by the prior test. A score write touches score_entries
    // only — the config hash must not move, or every entry would trigger a
    // needless full-config refetch on every device.
    const before = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 4 });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: memberId, unitLabel: "1", value: 5 });
    const after = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    expect(after).toBe(before);
  });

  it("CHANGES when a modifier / rule changes (the danger case)", async () => {
    const before = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    await ctx.caller().games.update({ tripId, gameId, rulesForToday: "Double the last 3 holes" });
    const after = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    expect(after).not.toBe(before);
  });

  it("CHANGES when a participant's handicap changes (setParticipantStrokes)", async () => {
    const before = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    await ctx.caller().playGroups.setParticipantStrokes({ tripId, gameId, userId: memberId, strokes: 6 });
    const after = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    expect(after).not.toBe(before);
  });

  it("a non-member cannot read the hash", async () => {
    // `planner` was never added to this trip → not a trip member.
    await expect(
      ctx.callerAs("planner").games.configHash({ tripId, gameId }),
    ).rejects.toThrow();
  });
});
