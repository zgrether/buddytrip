import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";
const MATCH_PLAY = "gtt_match_play";

/**
 * A COMPLETE game is not resurrected by going live (#889).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `games.enableScoring` and `matches.enableScoring` both wrote `status: 'active'`
 * unconditionally. `finish` deliberately leaves `scoring_enabled` TRUE — a
 * finished game is re-scoreable — so anything that re-affirms go-live un-completed
 * it: status complete -> active, a fresh `pairings_published_at` stamped on top,
 * and its result still posted to the board. That is #882's original bug, which
 * migration 111 closed inside `save_game_config` and which survived in these two
 * siblings because nothing production calls them.
 *
 * ── Why the assertions read the DATABASE ────────────────────────────────────
 * The bug is a column moving when it shouldn't, and CLAUDE.md #25's whole point is
 * that `status`, `scoring_enabled` and `pairings_published_at` must move TOGETHER.
 * A procedure returning `{ success: true }` proves nothing about that; the row
 * does. So each test reads all three back and asserts the whole tuple.
 */
let ctx: TestContext;
let tripId: string;
let ownerId: string;
let memberId: string;

/** All three go-live signals, straight from the row. */
async function signals(gameId: string) {
  const { data } = await ctx
    .authedClient("owner")
    .from("games")
    .select("status, scoring_enabled, pairings_published_at")
    .eq("id", gameId)
    .maybeSingle();
  return {
    status: data?.status as string,
    scoringEnabled: data?.scoring_enabled as boolean,
    published: data?.pairings_published_at != null,
  };
}

/**
 * A game in `games.finish`'s EXACT end state.
 *
 * Driven through `enableScoring` for real, then put into the finished state
 * directly rather than by entering 18 holes × N players of scores per test. The
 * three columns written here are character-for-character what `finish` writes
 * (`games.ts`, the `status: "complete", corrections_open: false,
 * scoring_enabled: true` update) — and `scoring_enabled` staying TRUE is not
 * incidental, it is the precise property that made this bug reachable: a finished
 * game is deliberately re-scoreable, so anything re-affirming go-live found the
 * door open. Migration 111's header records the same fact for the RPC path.
 */
async function finishedGame(gameTypeId: string, name: string) {
  const game = await ctx.caller().games.create({ tripId, gameTypeId, name });
  const gameId = game.id as string;
  await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [ownerId, memberId] });
  // The readiness prerequisite differs by format and runs BEFORE the guard under
  // test (`assertGameReady` first, then the update), so it has to be satisfied or
  // the refusal we assert would be the wrong refusal.
  if (gameTypeId === MATCH_PLAY) {
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [
        { matchNumber: 1, playersPerSide: 1, sideA: { members: [ownerId] }, sideB: { members: [memberId] } },
      ],
    });
  } else {
    await ctx.groupStrokeParticipants(gameId, [ownerId, memberId]);
  }
  await ctx.caller().games.enableScoring({ tripId, gameId });
  const { error } = await ctx
    .authedClient("owner")
    .from("games")
    .update({ status: "complete", corrections_open: false, scoring_enabled: true })
    .eq("id", gameId);
  if (error) throw new Error(`fixture: could not finish the game — ${error.message}`);
  return gameId;
}

describe("enableScoring cannot un-complete a finished game (#889)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Enable Scoring Guard Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("games.enableScoring refuses a complete game and moves NOTHING", async () => {
    const gameId = await finishedGame(STROKE_PLAY, "Finished Round");
    const before = await signals(gameId);
    expect(before.status, "precondition: finish leaves the game complete").toBe("complete");
    expect(
      before.scoringEnabled,
      "precondition: finish leaves scoring_enabled TRUE — that is what made this reachable",
    ).toBe(true);

    await expect(ctx.caller().games.enableScoring({ tripId, gameId })).rejects.toThrow(/finished/i);

    // The guard is a WHERE, so a refusal is a zero-row update: nothing partially
    // written, all three signals exactly as they were.
    expect(await signals(gameId)).toEqual(before);
  }, 60_000);

  it("matches.enableScoring refuses a complete game too — the second instance of one defect", async () => {
    // Match play reaches `complete` the same way; the point is that the sibling
    // procedure carried a character-identical unconditional write.
    const gameId = await finishedGame(MATCH_PLAY, "Finished Match");
    const before = await signals(gameId);

    await expect(ctx.caller().matches.enableScoring({ tripId, gameId })).rejects.toThrow(/finished/i);

    expect(await signals(gameId)).toEqual(before);
  }, 60_000);

  it("still enables a game that is NOT complete — the guard is not a blanket refusal", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Live Round" });
    const gameId = game.id as string;
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [ownerId, memberId] });
    await ctx.groupStrokeParticipants(gameId, [ownerId, memberId]);

    await ctx.caller().games.enableScoring({ tripId, gameId });

    // All three move TOGETHER (CLAUDE.md #25) — the state the guard must not block.
    expect(await signals(gameId)).toEqual({ status: "active", scoringEnabled: true, published: true });
  }, 60_000);

  it("a match game that is not complete still enables through matches.enableScoring", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Live Match" });
    const gameId = game.id as string;
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [ownerId, memberId] });
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [
        { matchNumber: 1, playersPerSide: 1, sideA: { members: [ownerId] }, sideB: { members: [memberId] } },
      ],
    });

    await ctx.caller().matches.enableScoring({ tripId, gameId });

    expect(await signals(gameId)).toEqual({ status: "active", scoringEnabled: true, published: true });
  }, 60_000);
});
