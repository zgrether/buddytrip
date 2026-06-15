import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Per-game delegate gate, extended to the SETUP routers (§10).
 *
 * Migration 045 landed the delegate path (game_organizers / requireGameEdit) on
 * games + game_results, but the setup mutations — matches (pairings / handicap /
 * activate) and playGroups (foursomes / strokes) — were still gated
 * requireTripRole("Organizer"). Stage 4 extends requireGameEdit() to them so a
 * game's delegate can actually run it. These tests assert the new gate:
 *   - a delegated member can run THEIR game's setup,
 *   - a plain member with no grant cannot,
 *   - the grant is game-isolated (delegate of A can't touch B).
 */

const MATCH = "gtt_match_play_singles";
const RACK = "gtt_rack_n_stack";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let memberId: string;
const gameIds: string[] = [];

async function newGame(gameTypeId: string, name: string) {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId,
    name,
    competitionId,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Delegate gate trip");
  await ctx.addTripMember(tripId, "member", "Member"); // plain Member = delegate target
  memberId = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "Delegate gate comp");
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_organizers").delete().eq("game_id", id);
    await ctx.admin.from("game_participants").delete().eq("game_id", id);
    await ctx.admin.from("game_matches").delete().eq("game_id", id);
    await ctx.admin.from("play_groups").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  await ctx.cleanup();
});

describe("matches setup gate admits the game delegate (§10)", () => {
  it("delegate can set pairings on THEIR game; a non-delegate member cannot", async () => {
    const mine = await newGame(MATCH, "Singles-BJ");
    const other = await newGame(MATCH, "Singles-other");
    await ctx.caller().games.addOrganizer({ tripId, gameId: mine, userId: memberId });

    const member = ctx.callerAs("member");
    const pairings = [{ sideA: null, sideB: null, matchNumber: 1 }];

    // Delegate runs their game's setup…
    await expect(
      member.matches.setPairings({ tripId, gameId: mine, matches: pairings })
    ).resolves.toBeTruthy();
    // …activate too.
    await expect(
      member.matches.activate({ tripId, gameId: mine })
    ).resolves.toBeTruthy();

    // …but NOT another game (game-isolated).
    await expect(
      member.matches.setPairings({ tripId, gameId: other, matches: pairings })
    ).rejects.toThrow(/Organizer|game-organizer/i);
  });

  it("a plain trip member with no grant cannot set pairings", async () => {
    const g = await newGame(MATCH, "Singles-nogrant");
    await expect(
      ctx.callerAs("member").matches.setPairings({
        tripId,
        gameId: g,
        matches: [{ sideA: null, sideB: null, matchNumber: 1 }],
      })
    ).rejects.toThrow(/Organizer|game-organizer/i);
  });
});

describe("playGroups setup gate admits the game delegate (§10)", () => {
  it("delegate can set foursomes on THEIR game; a non-delegate member cannot", async () => {
    const mine = await newGame(RACK, "Rack-BJ");
    const other = await newGame(RACK, "Rack-other");
    await ctx.caller().games.addOrganizer({ tripId, gameId: mine, userId: memberId });

    const member = ctx.callerAs("member");
    const groups = [{ userIds: [memberId] }];

    await expect(
      member.playGroups.setFoursomes({ tripId, gameId: mine, groups })
    ).resolves.toBeTruthy();

    await expect(
      member.playGroups.setFoursomes({ tripId, gameId: other, groups })
    ).rejects.toThrow(/Organizer|game-organizer/i);
  });

  it("a plain trip member with no grant cannot set foursomes", async () => {
    const g = await newGame(RACK, "Rack-nogrant");
    await expect(
      ctx.callerAs("member").playGroups.setFoursomes({
        tripId,
        gameId: g,
        groups: [{ userIds: [memberId] }],
      })
    ).rejects.toThrow(/Organizer|game-organizer/i);
  });
});
