import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * PR 9d — "yours first": a board row's `yours` is true when the VIEWER is
 * playing in the game or running it as a delegate, computed on the server.
 *
 * Through the real procedures, as two different viewers:
 *  - the flag is right for each viewer — playing, delegating, neither;
 *  - nobody else's id reaches the client to work it out (Zach, 9d: "return only
 *    the boolean for the viewer"). The rows are searched for another player's
 *    id, which the participant read now selects server-side;
 *  - THE BOUNDARY: the flag is computed under the viewer's own session, so it
 *    never knows more than they may read. `game_participants_select` shows a
 *    plain member a game's players only once scoring is open — so before that,
 *    their "playing" flag is false. Live now shows live games only, which always
 *    have scoring open, so it is never short of one.
 */

let ctx: TestContext;
let owner: string, member: string, outsider: string, planner: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  planner = ctx.getUser("planner").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** A stroke round with these players grouped, through the real procedures;
 *  `live` opens scoring, the state a Live now game is always in. */
async function round(tripId: string, competitionId: string | null, name: string, players: string[], live: boolean) {
  const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name, competitionId })) as { id: string };
  await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: players });
  await ctx.groupStrokeParticipants(game.id, players);
  if (live) await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  return game.id;
}

const yoursOf = (games: { id: string }[]) => Object.fromEntries(games.map((g) => [g.id, (g as { yours?: boolean }).yours]));

describe("board rows say which games are the viewer's", () => {
  it("cup games: playing in it, running it, or neither — per viewer", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Yours · cup", scoringModel: "points", members: ["member", "outsider", "planner"],
    });
    const playing = await round(tripId, competitionId, "Member plays", [member, outsider], true);
    const running = await round(tripId, competitionId, "Member runs", [outsider, planner], true);
    const neither = await round(tripId, competitionId, "Neither", [outsider, planner], true);
    const del = await ctx.admin.from("game_delegates").insert({ game_id: running, user_id: member, granted_by: owner });
    expect(del.error).toBeNull();

    const asMember = await ctx.callerAs("member").competitions.leaderboard({ tripId, competitionId });
    expect(yoursOf(asMember.games)).toEqual({ [playing]: true, [running]: true, [neither]: false });

    // The same board as somebody else is a different answer: the flag is the
    // VIEWER's, not the game's.
    const asOwner = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(yoursOf(asOwner.games)).toEqual({ [playing]: false, [running]: false, [neither]: false });

    // Nobody else's id is in the rows, though the server read it to count.
    expect(JSON.stringify(asMember.games)).not.toContain(outsider);
  });

  /**
   * #1599: a live game's row carries the VIEWER's own standing, and only theirs.
   * Through the real procedures: scores entered with `scores.upsertEntry`, the
   * board read as three different people. The decisive arm is the two players
   * reading DIFFERENT values off the same game: a build that sent one standing
   * per game (the first player's, say) passes the member's case and fails here.
   */
  it("a live cup game carries each player's OWN standing, and nobody else's", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Yours · standing", scoringModel: "points", members: ["member", "outsider"],
    });
    const gameId = await round(tripId, competitionId, "Standing round", [member, outsider], true);
    // Hole 1 is a par 4 on the default card: the member makes 5, the outsider 3.
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "1", value: 5 });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "1", value: 3 });

    const standingFor = async (as: "member" | "outsider" | null) => {
      const board = as
        ? await ctx.callerAs(as).competitions.leaderboard({ tripId, competitionId })
        : await ctx.caller().competitions.leaderboard({ tripId, competitionId });
      return (board.games.find((g) => g.id === gameId) as { standing?: unknown }).standing;
    };
    expect(await standingFor("member")).toEqual({ kind: "to_par", toPar: 1, thru: "1" });
    expect(await standingFor("outsider")).toEqual({ kind: "to_par", toPar: -1, thru: "1" });
    // The Owner runs the trip but isn't playing in this game: no standing.
    expect(await standingFor(null)).toBeNull();
  });

  it("side games carry the same flag", async () => {
    const tripId = await ctx.createTrip("Yours · side");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Member");
    const side = await round(tripId, null, "Side round", [member, outsider], true);

    const asMember = await ctx.callerAs("member").games.sideBoard({ tripId });
    expect(asMember.map((g) => [g.id, g.yours])).toEqual([[side, true]]);
    const asOwner = await ctx.caller().games.sideBoard({ tripId });
    expect(asOwner.map((g) => [g.id, g.yours])).toEqual([[side, false]]);
    expect(JSON.stringify(asMember)).not.toContain(outsider);
  });

  it("the flag never knows more than the viewer may read: before scoring opens, a member's 'playing' is false", async () => {
    const tripId = await ctx.createTrip("Yours · boundary");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Member");
    const pending = await round(tripId, null, "Not open yet", [member, outsider], false);
    const asMember = await ctx.callerAs("member").games.sideBoard({ tripId });
    expect(asMember.map((g) => [g.id, g.yours])).toEqual([[pending, false]]);
  });
});
