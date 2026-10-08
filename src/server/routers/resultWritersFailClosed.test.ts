import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";
import { buildDraw } from "../../lib/bracket";

/**
 * #1470 — a finalize whose read FAILS must not write, and must not complete.
 *
 * `resultWriters.readFailure.test.ts` pins every engine read against a fake
 * client. This file pins what only the real database shows, through
 * `games.finish` itself:
 *
 *  - the game is NOT marked complete when a read fails (finish writes status
 *    only after the engine returns);
 *  - on a RE-finalize (a correction), the game's existing rows are untouched —
 *    the case where "wrote zeros" and "deleted everything" cost real results;
 *  - the SETUP path: a pairing edit on a finished game recomputes its team rows
 *    and, on a failed read, must leave them alone without failing the edit;
 *  - the bracket, whose writer used to DELETE the results before reading the
 *    entrants, so a failed entrant read on a re-finalize left none.
 *
 * Every case builds its own game and runs failing → control → failing on it,
 * so the control proves this game's door writes, and no case inherits another's
 * state (a destructive write that got through in one case must not become the
 * starting state of the next — see #1469's `beforeEach`).
 *
 * `callerFailingRead` fails exactly one select (table + exact column string);
 * the sentence each case asserts is the family's own, so a failure from any
 * other door produces a different one.
 */

const SENTENCE = (what: string) => `Couldn't check the ${what} just now. This is temporary — try again in a moment.`;
const MATCH_PLAY = "gtt_match_play";
const CARD = "gtt_generic_card";

let ctx: TestContext;
// The match play cup lives on `tripId`; the points cup on its own trip, since a
// trip holds one competition (migration 195).
let tripId: string, pointsTripId: string;
let owner: string, member: string;
let mpCup: string, alpha: string, bravo: string;
let pointsCup: string, ptsAlpha: string, ptsBravo: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Result writers fail closed");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;

  // A MATCH PLAY cup: both teams always get a row, so a failed roster read here
  // is exactly the build that wrote 0 for each of them.
  mpCup = await ctx.createCompetition(tripId, "Match Play cup");
  alpha = await ctx.createTeam(mpCup, "Alpha");
  bravo = await ctx.createTeam(mpCup, "Bravo");
  await ctx.assignTeam(mpCup, alpha, [owner]);
  await ctx.assignTeam(mpCup, bravo, [member]);

  // Brackets are set up in points cups (ruling 2, PR 4).
  ({ tripId: pointsTripId, competitionId: pointsCup } = await ctx.createCupTrip({
    title: "Result writers fail closed",
    name: "Points cup",
    scoringModel: "points",
    members: ["member"],
  }));
  ptsAlpha = await ctx.createTeam(pointsCup, "Alpha");
  ptsBravo = await ctx.createTeam(pointsCup, "Bravo");
  await ctx.assignTeam(pointsCup, ptsAlpha, [owner]);
  await ctx.assignTeam(pointsCup, ptsBravo, [member]);
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function status(gameId: string): Promise<string> {
  const { data } = await ctx.admin.from("games").select("status").eq("id", gameId).single();
  return (data as { status: string }).status;
}

async function teamRows(gameId: string): Promise<Record<string, number>> {
  const { data } = await ctx.admin.from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
  return Object.fromEntries((data ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
}

/** Every row, minus the ids a rewrite re-mints — what "untouched" compares. */
async function allRows(gameId: string) {
  const { data } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, raw_score, position")
    .eq("game_id", gameId)
    .order("entity_type")
    .order("entity_id");
  return data ?? [];
}

/** Golf match play, outcome entry: owner (Alpha) takes 10 holes, a 10&8 win worth 3. */
async function decidedGolfMatch(name: string): Promise<{ gameId: string; matchId: string }> {
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: MATCH_PLAY, name, competitionId: mpCup,
    pointsTotal: 3, pointsDistribution: { type: "per_match", value: 3 },
  })) as { id: string };
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", game.id);
  const matches = (await ctx.caller().matches.setPairings({
    tripId, gameId: game.id,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
  })) as { id: string }[];
  await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  for (let h = 1; h <= 10; h++) {
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId: game.id, matchId: matches[0].id, holeNumber: h, result: "side_a" });
  }
  return { gameId: game.id, matchId: matches[0].id };
}

const finish = (gameId: string, trip: string = tripId) => ctx.caller().games.finish({ tripId: trip, gameId });
const failingFinish = (gameId: string, table: string, columns: string, trip: string = tripId) =>
  callerFailingRead(ctx, "owner", { table, columns }).games.finish({ tripId: trip, gameId });

describe("golf match play — games.finish", () => {
  it("a failed ROSTER read neither completes the game nor writes the teams 0", async () => {
    const { gameId } = await decidedGolfMatch("Roster read fails");
    const read = ["team_assignments", "user_id, team_id"] as const;

    await expect(failingFinish(gameId, ...read)).rejects.toThrow(SENTENCE("cup's rosters"));
    expect(await status(gameId)).not.toBe("complete");
    expect(await teamRows(gameId)).toEqual({});

    // CONTROL on the same game: the door writes, and this is the value at stake.
    await finish(gameId);
    expect(await teamRows(gameId)).toEqual({ [alpha]: 3, [bravo]: 0 });

    // Re-finalize (a correction). Once a game has finalized it is credited
    // through the roster it finalized with (203), so the roster read is no
    // longer made at all: failing it changes nothing. The read that IS made is
    // the credited roster's — and with THAT failing, Alpha keeps its 3.
    await failingFinish(gameId, ...read);
    expect(await teamRows(gameId)).toEqual({ [alpha]: 3, [bravo]: 0 });
    await expect(failingFinish(gameId, "games", "credited_roster, trip_id")).rejects.toThrow(SENTENCE("game's credited roster"));
    expect(await teamRows(gameId)).toEqual({ [alpha]: 3, [bravo]: 0 });
  }, 180_000);

  it("a failed MATCHES read does not replace the game's rows with none", async () => {
    const { gameId } = await decidedGolfMatch("Matches read fails");
    const read = ["game_matches", "id, side_a, side_b, status, result, point_value"] as const;

    await expect(failingFinish(gameId, ...read)).rejects.toThrow(SENTENCE("game's matches"));
    expect(await status(gameId)).not.toBe("complete");

    await finish(gameId);
    const written = await allRows(gameId);
    expect(written.length).toBe(4); // two side rows, two team rows

    await expect(failingFinish(gameId, ...read)).rejects.toThrow(SENTENCE("game's matches"));
    expect(await allRows(gameId)).toEqual(written);
  }, 180_000);
});

describe("non-golf Matches — games.finish's own matches read", () => {
  it("a failed read neither completes the game nor pays nobody", async () => {
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name: "Cards", competitionId: mpCup })) as { id: string };
    const gameId = g.id;
    await ctx.admin
      .from("games")
      .update({ competition_format: MATCHES_COMPETITION_FORMAT, points_total: 4, points_distribution: { type: "per_match", value: 4 } })
      .eq("id", gameId);
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: hash,
      payload: {
        name: "Cards", rulesForToday: null, scoringEnabled: true, pointsTotal: 4,
        pointsDistribution: { type: "per_match", value: 4 }, courseId: null, backCourseId: null,
        scorecardSchema: null, delegates: [], competitionFormat: MATCHES_COMPETITION_FORMAT,
        matches: [{ matchNumber: 1, playersPerSide: 1, a: [owner], b: [member], strokesA: 0, strokesB: 0, pointValue: null }],
        matchesStructureDirty: true,
      },
    });
    const { data: m } = await ctx.admin.from("game_matches").select("id").eq("game_id", gameId).single();
    await ctx.caller().matches.setResult({ tripId, gameId, matchId: (m as { id: string }).id, result: "b_win" });
    const read = ["game_matches", "id, side_a, side_b, result, point_value"] as const;

    await expect(failingFinish(gameId, ...read)).rejects.toThrow(SENTENCE("game's matches"));
    expect(await status(gameId)).not.toBe("complete");
    expect(await teamRows(gameId)).toEqual({});

    await finish(gameId);
    expect(await teamRows(gameId)).toEqual({ [alpha]: 0, [bravo]: 4 });

    await expect(failingFinish(gameId, ...read)).rejects.toThrow(SENTENCE("game's matches"));
    expect(await teamRows(gameId)).toEqual({ [alpha]: 0, [bravo]: 4 });
  }, 180_000);
});

describe("the SETUP path — a pairing edit on a finished game", () => {
  it("a failed roster read leaves the team rows alone, and the edit itself still succeeds", async () => {
    const { gameId, matchId } = await decidedGolfMatch("Setup recompute");
    await finish(gameId);
    expect(await teamRows(gameId)).toEqual({ [alpha]: 3, [bravo]: 0 });

    // `setPointValue` recomputes the team rows (no status gate). With the roster
    // read failing it used to write Alpha 0, Bravo 0 over a finished result. A
    // finished game now reads its CREDITED roster instead of the live one (203),
    // so that is the read failed here.
    const failing = callerFailingRead(ctx, "owner", { table: "games", columns: "credited_roster, trip_id" });
    await expect(failing.matches.setPointValue({ tripId, gameId, matchId, value: 5 })).resolves.toEqual({ ok: true });
    expect(await teamRows(gameId)).toEqual({ [alpha]: 3, [bravo]: 0 });

    // CONTROL: the same edit with real reads DOES rewrite them.
    await ctx.caller().matches.setPointValue({ tripId, gameId, matchId, value: 5 });
    expect(await teamRows(gameId)).toEqual({ [alpha]: 5, [bravo]: 0 });
  }, 180_000);
});

describe("bracket — the entrant read comes before the delete", () => {
  it("a failed entrant read on a re-finalize leaves the bracket's results in place", async () => {
    const tripId = pointsTripId;
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name: "Bracket", competitionId: pointsCup })) as { id: string };
    const gameId = g.id;
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: hash,
      payload: {
        name: "Bracket", rulesForToday: null, scoringEnabled: true, pointsTotal: 8, pointsDistribution: null,
        courseId: null, backCourseId: null, scorecardSchema: null, delegates: [],
        competitionFormat: "bracket" as const,
        bracketConfig: { elimination: "single" as const, entrants: "singles" as const, seeding: "manual" as const, consolation: false },
        bracketEntrants: [
          { seed: 1, teamId: ptsAlpha, userIds: [owner] },
          { seed: 2, teamId: ptsBravo, userIds: [member] },
        ],
        bracketDraw: buildDraw(2, { consolation: false }),
      },
    });
    await ctx.caller().games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: 1, winnerSeed: 1 });
    const read = ["bracket_entrants", "id, team_id"] as const;
    const refusal = "Failed to read the bracket's entrants";

    await expect(failingFinish(gameId, ...read, tripId)).rejects.toThrow(refusal);
    expect(await status(gameId)).not.toBe("complete");

    await finish(gameId, tripId);
    const written = await allRows(gameId);
    expect(written.length).toBe(2);

    // Before #1470 the writer deleted first, so this left the bracket with none.
    await expect(failingFinish(gameId, ...read, tripId)).rejects.toThrow(refusal);
    expect(await allRows(gameId)).toEqual(written);
  }, 180_000);
});
