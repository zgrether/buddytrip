import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";
import { isTerminalRefusal } from "@/lib/terminalRefusal";

/**
 * #1276 — a failed read inside a SCORE-WRITE GATE must not read as "not
 * allowed".
 *
 * `canWriteScore`, `canWriteOutcome`, `canWriteSkinsHole` and `canEditGame`
 * read rows to decide who may write. A failed read used to come back as `null`
 * and answer `false`; the write then threw a terminal FORBIDDEN, and all three
 * client savers (`useScoreSaver`, `useOutcomeSaver`, `useSkinsSaver`) clear
 * their durable outbox on a terminal refusal. A database blip mid-round lost
 * the score on the next reload.
 *
 * Each case fails exactly ONE of a gate's reads for a plain member's own,
 * legitimate write, and asserts two things:
 *  - the error is NOT terminal (`isTerminalRefusal`, the same check the savers
 *    make), so the outbox keeps the value and re-sends it;
 *  - nothing was written.
 * Each gate has a CONTROL: the same write through working reads lands, which
 * shows the member really is allowed and the failure is the only difference.
 */

let ctx: TestContext;
let member: string;

async function expectRetryable(p: Promise<unknown>) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let caught: unknown = null;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  vi.restoreAllMocks();
  expect(caught, "the write must fail while the read fails").not.toBeNull();
  expect((caught as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
  expect(isTerminalRefusal(caught), "a failed read must never be terminal: the outbox would drop the score").toBe(false);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("canWriteScore (scores.upsertEntry)", () => {
  let tripId: string;
  let gameId: string;

  beforeAll(async () => {
    tripId = await ctx.createTrip("1276 scores");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Member");
    const outsider = ctx.getUser("outsider").id;
    const g = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "1276 stroke" });
    gameId = g.id as string;
    // A game takes at least two players; each is grouped on their own.
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [member, outsider] });
    await ctx.groupStrokeParticipants(gameId, [member]);
    await ctx.groupStrokeParticipants(gameId, [outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId });
  }, 60_000);

  const scoreAt = async (unit: string) =>
    (
      await ctx.admin.from("score_entries").select("value").eq("game_id", gameId).eq("participant_id", member).eq("unit_label", unit).maybeSingle()
    ).data;

  it.each([
    ["the game's delegates (canEditGame)", { table: "game_delegates", columns: "game_id" }, "11"],
    ["the game's format", { table: "games", columns: "game_type_id" }, "12"],
    ["the game's matches", { table: "game_matches", columns: "side_a, side_b" }, "13"],
    ["the game's players", { table: "game_participants", columns: "user_id, play_group_id" }, "14"],
  ])("a failed read of %s is retryable, and nothing is written", async (_label, target, unit) => {
    await expectRetryable(
      callerFailingRead(ctx, "member", target).scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: unit, value: 4 })
    );
    expect(await scoreAt(unit)).toBeNull();
  }, 60_000);

  it("CONTROL: through working reads, the member's own score saves", async () => {
    await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "15", value: 4 });
    expect(await scoreAt("15")).toEqual({ value: 4 });
  }, 60_000);
});

describe("canWriteOutcome (matchOutcomes.upsertOutcome)", () => {
  let tripId: string;
  let gameId: string;
  let matchId: string;

  beforeAll(async () => {
    tripId = await ctx.createTrip("1276 outcomes");
    await ctx.addTripMember(tripId, "member", "Member");
    const g = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "1276 match" });
    gameId = g.id as string;
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [ctx.user.id] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });
  }, 60_000);

  const outcomeAt = async (hole: number) =>
    (await ctx.admin.from("match_hole_outcomes").select("result").eq("match_id", matchId).eq("hole_number", hole).maybeSingle()).data;

  it.each([
    ["the game's delegates (canEditGame)", { table: "game_delegates", columns: "game_id" }, 11],
    ["the match", { table: "game_matches", columns: "side_a, side_b" }, 12],
    ["the game's players", { table: "game_participants", columns: "play_group_id" }, 13],
  ])("a failed read of %s is retryable, and nothing is written", async (_label, target, hole) => {
    await expectRetryable(
      callerFailingRead(ctx, "member", target).matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: hole, result: "side_b" })
    );
    expect(await outcomeAt(hole)).toBeNull();
  }, 60_000);

  it("CONTROL: through working reads, the member's own match outcome saves", async () => {
    await ctx.callerAs("member").matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: 14, result: "side_b" });
    expect(await outcomeAt(14)).toEqual({ result: "side_b" });
  }, 60_000);
});

describe("canWriteSkinsHole (skinsOutcomes.upsertHole)", () => {
  let tripId: string;
  let gameId: string;
  let groupingId: string;

  beforeAll(async () => {
    const cup = await ctx.createCupTrip({
      title: "1276 skins",
      name: "1276 skins cup",
      scoringModel: "points",
      members: [["member", "Member"]],
    });
    tripId = cup.tripId;
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_skins", name: "1276 skins", competitionId: cup.competitionId,
    })) as { id: string };
    gameId = g.id;
    const outsider = ctx.getUser("outsider").id;
    await ctx.addTripMember(tripId, "outsider", "Member");
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [member, outsider] });
    groupingId = await ctx.groupStrokeParticipants(gameId, [member, outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId });
  }, 60_000);

  const holeAt = async (hole: number) =>
    (
      await ctx.admin.from("skins_hole_outcomes").select("result").eq("grouping_id", groupingId).eq("hole_number", hole).maybeSingle()
    ).data;

  it.each([
    ["the game's delegates (canEditGame)", { table: "game_delegates", columns: "game_id" }, 11],
    ["the grouping", { table: "play_groups", columns: "id" }, 12],
    ["the game's players", { table: "game_participants", columns: "play_group_id" }, 13],
  ])("a failed read of %s is retryable, and nothing is written", async (_label, target, hole) => {
    await expectRetryable(
      callerFailingRead(ctx, "member", target).skinsOutcomes.upsertHole({ tripId, gameId, groupingId, holeNumber: hole, result: "tied", winnerId: null })
    );
    expect(await holeAt(hole)).toBeNull();
  }, 60_000);

  it("CONTROL: through working reads, the member's own grouping's hole saves", async () => {
    await ctx.callerAs("member").skinsOutcomes.upsertHole({ tripId, gameId, groupingId, holeNumber: 14, result: "tied", winnerId: null });
    expect(await holeAt(14)).toEqual({ result: "tied" });
  }, 60_000);
});
