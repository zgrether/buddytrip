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
let ownerId: string;
let memberId: string;

/**
 * EVERY CASE BUILDS ITS OWN GAME (#1527, found at seed 90210). They shared one,
 * and "does NOT change when only SCORES change" said so in its first line:
 * "Scoring is enabled by the prior test". Shuffled ahead of the go-live case,
 * its score writes were refused ("Enable scoring before entering scores").
 */
type Game = { tripId: string; gameId: string };

/** A grouped two-player stroke game (stroke go-live requires groups, mig 089); live on request. */
async function hashGame(label: string, opts: { live: boolean }): Promise<Game> {
  const tripId = await ctx.createTrip(`Config Hash ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Round" });
  await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [ownerId, memberId] });
  await ctx.groupStrokeParticipants(game.id, [ownerId, memberId]);
  if (opts.live) await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  return { tripId, gameId: game.id as string };
}

const hashOf = async (g: Game) => (await ctx.caller().games.configHash({ tripId: g.tripId, gameId: g.gameId })).hash;

describe("games.configHash — config change-signal", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("any trip member can read the hash (a short string)", async () => {
    const g = await hashGame("member-read", { live: false });
    const { hash } = await ctx.callerAs("member").games.configHash({ tripId: g.tripId, gameId: g.gameId });
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is STABLE when nothing changes (no false 'changed')", async () => {
    const g = await hashGame("stable", { live: false });
    expect(await hashOf(g)).toBe(await hashOf(g));
  });

  it("CHANGES when config changes — go-live (enableScoring)", async () => {
    const g = await hashGame("go-live", { live: false });
    const before = await hashOf(g);
    await ctx.caller().games.enableScoring({ tripId: g.tripId, gameId: g.gameId });
    expect(await hashOf(g)).not.toBe(before);
  });

  it("does NOT change when only SCORES change (the efficiency guarantee)", async () => {
    // A score write touches score_entries only — the config hash must not move,
    // or every entry would trigger a needless full-config refetch on every device.
    const g = await hashGame("scores", { live: true });
    const before = await hashOf(g);
    await ctx.caller().scores.upsertEntry({ tripId: g.tripId, gameId: g.gameId, participantId: ownerId, unitLabel: "1", value: 4 });
    await ctx.caller().scores.upsertEntry({ tripId: g.tripId, gameId: g.gameId, participantId: memberId, unitLabel: "1", value: 5 });
    // Control: the scores really landed, so "the hash did not move" is about
    // scores and not about writes that never happened.
    const { count, error } = await ctx.admin
      .from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", g.gameId);
    if (error) throw new Error(`count scores: ${error.message}`);
    expect(count).toBe(2);
    expect(await hashOf(g)).toBe(before);
  });

  it("CHANGES when a modifier / rule changes (the danger case)", async () => {
    const g = await hashGame("rules", { live: true });
    const before = await hashOf(g);
    await ctx.caller().games.update({ tripId: g.tripId, gameId: g.gameId, rulesForToday: "Double the last 3 holes" });
    expect(await hashOf(g)).not.toBe(before);
  });

  it("CHANGES when a participant's handicap changes (setParticipantStrokes)", async () => {
    const g = await hashGame("handicap", { live: true });
    const before = await hashOf(g);
    await ctx.caller().playGroups.setParticipantStrokes({ tripId: g.tripId, gameId: g.gameId, userId: memberId, strokes: 6 });
    expect(await hashOf(g)).not.toBe(before);
  });

  it("a non-member cannot read the hash", async () => {
    // `planner` was never added to this trip → not a trip member.
    const g = await hashGame("non-member", { live: false });
    await expect(
      ctx.callerAs("planner").games.configHash({ tripId: g.tripId, gameId: g.gameId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
