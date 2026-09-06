import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `pickem.setScore` — the manual entry path for the contest's own final.
 *
 * ── What is actually at risk here ─────────────────────────────────────────
 *
 * The procedure body is one UPDATE, so there is no arithmetic to get wrong.
 * What CAN be wrong is everything around it, and each of those is a real
 * failure somebody would meet:
 *
 *   - the gate. A plain `.update()` on a table is only as safe as
 *     `pickem_slate_games_write`, and unlike `set_pickem_result` there is no
 *     SECURITY DEFINER function re-checking anything. If that policy were ever
 *     widened, a member could write scores onto somebody else's slate and
 *     nothing in the procedure would notice.
 *   - the `game_id` filter. Without it a slate id from ANOTHER game is updated
 *     under a permission `requireGameEdit` granted for THIS one — the whole
 *     authorisation is for the wrong object, and it fails silently.
 *   - the independence. The standing rule is that a score is NEVER interpreted:
 *     cover against the spread stays the runner's call, because the spread is
 *     hand-entered too. A build that helpfully derived a result from a score
 *     would be a judgement turned into an automatic decision.
 *   - empty is not zero. Null clears back to unknown; 0 is a scoreless final.
 *
 * Every case below writes a real row and reads it back, for the reason
 * `pickemSlateScores.test.ts` gives at length: a probe that compares a literal
 * to a literal would pass with the feature absent.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let otherGameId: string;
let slateId: string;
let otherSlateId: string;

async function scoreRow(id = slateId) {
  const { data } = await ctx.admin
    .from("pickem_slate_games")
    .select("away_score, home_score, result")
    .eq("id", id)
    .single();
  return data as { away_score: number | null; home_score: number | null; result: string | null };
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Pick'em Score Entry Trip");
  await ctx.addTripMember(tripId, "member", "Member");

  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Scores",
  })) as { id: string };
  gameId = g.id;

  /**
   * A SECOND game in the same trip, for the cross-game case.
   *
   * In the same trip deliberately: a caller who is Owner here is Owner there
   * too, so `requireGameEdit` passes for both and the ONLY thing standing
   * between the two rows is the `game_id` filter on the UPDATE. A second trip
   * would have been refused by the middleware and would have tested nothing.
   */
  const g2 = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Other slate",
  })) as { id: string };
  otherGameId = g2.id;

  slateId = genId("sg");
  otherSlateId = genId("sg");
  const seed = await ctx.admin.from("pickem_slate_games").insert([
    {
      id: slateId,
      game_id: gameId,
      display_order: 0,
      away_team: "Toledo",
      home_team: "Michigan State",
    },
    {
      id: otherSlateId,
      game_id: otherGameId,
      display_order: 0,
      away_team: "Rice",
      home_team: "Houston",
    },
  ]);
  // ASSERTED — a seed whose error is never read reports a confident wrong
  // answer about the thing under test (this exact insert failed silently once,
  // on `game_type_id: "pickem"` against a real `gtt_pickem`).
  expect(seed.error, "seed: slate insert").toBeNull();
}, 60_000);

beforeEach(async () => {
  await ctx.admin
    .from("pickem_slate_games")
    .update({ away_score: null, home_score: null, result: null })
    .eq("id", slateId);
  await ctx.admin
    .from("pickem_slate_games")
    .update({ away_score: null, home_score: null })
    .eq("id", otherSlateId);
});

afterAll(async () => {
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", otherGameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.admin.from("games").delete().eq("id", otherGameId);
  await ctx.cleanup();
});

describe("the runner writes a score", () => {
  it("stores both numbers", async () => {
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: 17,
      homeScore: 24,
    });
    expect(await scoreRow()).toMatchObject({ away_score: 17, home_score: 24 });
  });

  it("stores 0 as a SCORE and null as an ABSENCE, which are not the same row", async () => {
    /**
     * The distinction this whole feature is built around, at the one layer that
     * can still lose it. A build coercing empty to 0 passes any "the score
     * saved" assertion and turns every un-entered game into a scoreless tie.
     */
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: 0,
      homeScore: 0,
    });
    expect(await scoreRow()).toMatchObject({ away_score: 0, home_score: 0 });

    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: null,
      homeScore: null,
    });
    const cleared = await scoreRow();
    expect(cleared.away_score).toBeNull();
    expect(cleared.home_score).toBeNull();
  });

  it("admits HALF a score, because entry passes through that state", async () => {
    // Refused at the READ, never at the write — a constraint here would reject
    // the first keystroke of every score ever entered.
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: 21,
      homeScore: null,
    });
    expect(await scoreRow()).toMatchObject({ away_score: 21, home_score: null });
  });

  it("refuses a negative score before it reaches the column", async () => {
    // The zod floor and the CHECK say the same thing; this is the one a person
    // meets, and it must not depend on the other being there.
    await expect(
      ctx.caller().pickem.setScore({
        tripId,
        gameId,
        slateGameId: slateId,
        awayScore: -1,
        homeScore: 3,
      })
    ).rejects.toThrow();
  });
});

describe("a score is never interpreted", () => {
  it("leaves an UNMARKED game unmarked", async () => {
    /**
     * THE MUTATION: derive the result from the two numbers. It is the obvious
     * convenience and it is forbidden — the spread is hand-entered, so a cover
     * derived from a score would be an automatic decision made from two inputs
     * nobody checked.
     */
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: 3,
      homeScore: 42,
    });
    expect((await scoreRow()).result).toBeNull();
  });

  it("leaves a MARKED game's result exactly as the runner set it", async () => {
    // Including — deliberately — a score that contradicts it. The runner marked
    // the away side; the numbers say the home side won by 39; the result stands,
    // because a spread can make both true and only the runner knows.
    await ctx.admin.from("pickem_slate_games").update({ result: "away" }).eq("id", slateId);
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: 3,
      homeScore: 42,
    });
    const row = await scoreRow();
    expect(row.result).toBe("away");
    expect(row.away_score).toBe(3);
  });

  it("and a result write leaves the score alone", async () => {
    // The other direction, so the independence is not only true one way round.
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: slateId,
      awayScore: 17,
      homeScore: 24,
    });
    await ctx.caller().pickem.setResult({ tripId, gameId, slateGameId: slateId, result: "home" });
    expect(await scoreRow()).toMatchObject({ away_score: 17, home_score: 24, result: "home" });
  });
});

describe("the gate", () => {
  it("refuses a MEMBER", async () => {
    await expect(
      ctx.callerAs("member").pickem.setScore({
        tripId,
        gameId,
        slateGameId: slateId,
        awayScore: 99,
        homeScore: 0,
      })
    ).rejects.toThrow();
    // ...and the row is untouched, which is the half a rejection alone does not
    // prove: a procedure that threw AFTER writing would pass the line above.
    expect((await scoreRow()).away_score).toBeNull();
  });

  it("cannot reach a slate game belonging to another game", async () => {
    /**
     * THE MUTATION: drop `.eq("game_id", input.gameId)`.
     *
     * The caller is Owner of both games, so `requireGameEdit` passes either
     * way and nothing about the request looks wrong. The filter is the only
     * thing tying the row to the game the middleware authorised, and without it
     * this write lands on the other slate.
     */
    await ctx.caller().pickem.setScore({
      tripId,
      gameId,
      slateGameId: otherSlateId,
      awayScore: 55,
      homeScore: 55,
    });
    const other = await scoreRow(otherSlateId);
    expect(other.away_score, "the other game's row was written").toBeNull();
  });
});
