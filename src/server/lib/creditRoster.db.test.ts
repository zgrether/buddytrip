import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * The database half of migration 203 (PR 8a), through the real stack.
 *
 * `creditRoster.test.ts` proves each writer READS the credited roster, on a fake
 * client. This proves the rest, which only Postgres can:
 *
 *   - end to end: finalize, trade, correct, re-finalize — the team rows stay
 *     with the roster the game finalized with, through `games.finish` and the
 *     real `write_game_results`. With a CONTROL: the same trade made BEFORE the
 *     first finalize moves the credit, so the fixture's trade is real;
 *   - a scoring reset clears it, and the replayed game is credited through the
 *     roster at ITS finalize.
 *
 * The migration's own contract (first roster wins, non-map refused, merge
 * re-keying) is pinned without any writer in `creditedRosterMigration.db.test.ts`.
 *
 * The roster lock still refuses a trade on a scored cup (PR 8b lifts it), so the
 * trade here is a direct write — the state 8b will make reachable.
 */

const STROKE = "gtt_stroke_play";
const ROUND = 18;

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.getUser("owner").id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** A fresh cup per case (a trip holds one, migration 195): Alpha = owner +
 *  planner, Bravo = member + outsider, and a stroke game with all four in it,
 *  scoring on. */
async function strokeCup(name: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({
    name, scoringModel: "points",
    members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
  });
  const alpha = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const bravo = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: alpha },
    { competition_id: competitionId, user_id: planner, team_id: alpha },
    { competition_id: competitionId, user_id: member, team_id: bravo },
    { competition_id: competitionId, user_id: outsider, team_id: bravo },
  ]);
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: STROKE, name: `${name} round`, competitionId,
  })) as { id: string };
  await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner, member, outsider] });
  await ctx.groupStrokeParticipants(game.id, [owner, planner, member, outsider]);
  await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
  return { tripId, competitionId, gameId: game.id, alpha, bravo };
}

/** Hole 1 carries the score; holes 2..18 are 0 so the round completes. */
async function playRound(tripId: string, gameId: string, hole1: [string, number][]) {
  for (const [participantId, value] of hole1) {
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId, unitLabel: "1", value });
  }
  await ctx.admin.from("score_entries").insert(
    hole1.flatMap(([pid]) =>
      Array.from({ length: ROUND - 1 }, (_, i) => ({
        id: crypto.randomUUID(), game_id: gameId, participant_id: pid, participant_type: "user",
        unit_label: String(i + 2), value: 0, annotations: {}, submitted_by: owner,
        submitted_at: new Date().toISOString(),
      }))
    )
  );
}

/** { teamId: raw_score } for the game's team rows. */
async function teamTotals(gameId: string): Promise<Record<string, number>> {
  const { data, error } = await ctx.admin
    .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
}

async function creditedRoster(gameId: string): Promise<unknown> {
  const { data, error } = await ctx.admin.from("games").select("credited_roster").eq("id", gameId).single();
  if (error) throw error;
  return data.credited_roster;
}

async function trade(competitionId: string, userId: string, toTeam: string) {
  const { error } = await ctx.admin
    .from("team_assignments").update({ team_id: toTeam })
    .eq("competition_id", competitionId).eq("user_id", userId);
  if (error) throw error;
}

const SCORES = (): [string, number][] => [[owner, 5], [planner, 6], [member, 4], [outsider, 4]];

describe("a finished game keeps the roster it was credited through (end to end)", () => {
  it("trade after finalize, then a correction: the round stays with the team it finished for", async () => {
    const c = await strokeCup("Credit kept");
    await playRound(c.tripId, c.gameId, SCORES());
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });

    expect(await creditedRoster(c.gameId)).toEqual({ [owner]: c.alpha, [planner]: c.alpha, [member]: c.bravo, [outsider]: c.bravo });
    expect(await teamTotals(c.gameId)).toEqual({ [c.alpha]: 11, [c.bravo]: 8 });

    // The planner is traded to Bravo, then a correction fixes their hole 1.
    await trade(c.competitionId, planner, c.bravo);
    await ctx.caller().games.openCorrection({ tripId: c.tripId, gameId: c.gameId });
    await ctx.caller().scores.upsertEntry({ tripId: c.tripId, gameId: c.gameId, participantId: planner, unitLabel: "1", value: 7 });
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });

    // The corrected 7 lands on ALPHA, the team the round was played for. Through
    // today's roster it would be Alpha 5, Bravo 15.
    expect(await teamTotals(c.gameId)).toEqual({ [c.alpha]: 12, [c.bravo]: 8 });
    expect(await creditedRoster(c.gameId)).toEqual({ [owner]: c.alpha, [planner]: c.alpha, [member]: c.bravo, [outsider]: c.bravo });
  });

  it("CONTROL: the same trade BEFORE the first finalize does move the credit", async () => {
    const c = await strokeCup("Credit moves");
    await playRound(c.tripId, c.gameId, SCORES());
    await trade(c.competitionId, planner, c.bravo);
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });

    expect(await teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 14 });
    expect(await creditedRoster(c.gameId)).toEqual({ [owner]: c.alpha, [planner]: c.bravo, [member]: c.bravo, [outsider]: c.bravo });
  });

  it("a scoring reset clears it, so the replayed game is credited through the roster at ITS finalize", async () => {
    const c = await strokeCup("Credit reset");
    await playRound(c.tripId, c.gameId, SCORES());
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });
    expect(await creditedRoster(c.gameId)).not.toBeNull();

    await ctx.caller().games.resetScoring({ tripId: c.tripId, gameId: c.gameId });
    expect(await creditedRoster(c.gameId)).toBeNull();

    // Replayed after a trade: this finalize is a first finalize again.
    await trade(c.competitionId, planner, c.bravo);
    await ctx.caller().games.enableScoring({ tripId: c.tripId, gameId: c.gameId });
    await playRound(c.tripId, c.gameId, SCORES());
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });
    expect(await teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 14 });
  });
});
