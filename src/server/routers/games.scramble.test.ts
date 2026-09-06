import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * SCRAMBLE — the team is the scorer, and there is no individual level.
 *
 * ── Why the headline assertion is an ABSENCE, and asserted here ─────────────
 *
 * "The leaderboard shows teams only" is easy to satisfy wrongly: run the
 * individual aggregation as usual and don't render the section. That build
 * looks identical on screen and is one CSS change from the rows coming back,
 * so a rendering test cannot tell the two apart.
 *
 * So it is asserted where a hidden section still leaves a trace — in
 * `game_results`. A scramble finalize must produce NO `entity_type='user'` rows
 * at all, because there are no player scores to aggregate. A build that merely
 * hid the section would write them and fail here.
 *
 * The stroke control in the second test is what keeps that from being vacuous:
 * the same finalize, the same helper, the same competition, and user rows DO
 * appear. Without it "no user rows" would also pass against a finalize that
 * wrote nothing at all.
 */

const SCRAMBLE = "gtt_scramble";
const STROKE_PLAY = "gtt_stroke_play";
const ROUND = 18;

/** Fill holes 2..18 for each participant so the round COMPLETES and qualifies.
 *  `participantType` is the whole point here — a scramble game's units are its
 *  play_groups, so its rows carry 'play_group' and a stroke game's carry 'user'. */
async function completeRound(
  ctx: TestContext,
  gameId: string,
  participantType: "user" | "play_group",
  fill: [string, number][],
  submittedBy: string
) {
  const rows = fill.flatMap(([pid, value]) =>
    Array.from({ length: ROUND - 1 }, (_, i) => ({
      id: crypto.randomUUID(),
      game_id: gameId,
      participant_id: pid,
      participant_type: participantType,
      unit_label: String(i + 2),
      value,
      annotations: {},
      submitted_by: submittedBy,
      submitted_at: new Date().toISOString(),
    }))
  );
  await ctx.admin.from("score_entries").insert(rows);
}

let ctx: TestContext;
let tripId: string;

describe("scramble — the team is the scorer", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Scramble Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("banks a result per TEAM GROUP and NOT ONE individual row", async () => {
    const comp = await ctx.createCompetition(tripId, "Scramble Cup", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });

    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    const member = ctx.getUser("member").id;
    const outsider = ctx.getUser("outsider").id;

    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamA },
      { competition_id: comp, user_id: member, team_id: teamB },
      { competition_id: comp, user_id: outsider, team_id: teamB },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SCRAMBLE, name: "The Scramble", competitionId: comp,
    })) as { id: string };
    await ctx.caller().games.addParticipants({
      tripId, gameId: game.id, userIds: [owner, planner, member, outsider],
    });

    // One group per team — the shape the client defaults to, and the thing that
    // actually carries a score.
    const groupA = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    const groupB = await ctx.groupStrokeParticipants(game.id, [member, outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    // Hole 1 carries the score; Alpha 8, Bravo 6 → Bravo lower, Bravo wins.
    for (const [participantId, value] of [[groupA, 8], [groupB, 6]] as [string, number][]) {
      await ctx.caller().scores.upsertEntry({
        tripId, gameId: game.id, participantId, unitLabel: "1", value,
        participantType: "play_group",
      });
    }
    await completeRound(ctx, game.id, "play_group", [[groupA, 0], [groupB, 0]], owner);

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score, position")
      .eq("game_id", game.id);

    // THE HEADLINE: not one individual row was produced. Not hidden — absent.
    expect((rows ?? []).filter((r) => r.entity_type === "user")).toEqual([]);

    // The groups ARE the standings, keyed as groups rather than mislabelled as
    // people — `game_results.entity_type` admits all three precisely so this can
    // say what it means.
    const groups = (rows ?? [])
      .filter((r) => r.entity_type === "play_group")
      .map((r) => [r.entity_id, r.raw_score, r.position]);
    expect(groups).toEqual(
      expect.arrayContaining([[groupB, 6, 1], [groupA, 8, 2]])
    );
    expect(groups).toHaveLength(2);

    // And the CUP still gets its team rows, resolved group → team through the
    // members' roster. Without this a scramble game would finalize and
    // contribute nothing, which is exactly the bug stroke play shipped once.
    const teams = (rows ?? [])
      .filter((r) => r.entity_type === "team")
      .map((r) => [r.entity_id, r.raw_score, r.position]);
    expect(teams).toEqual(expect.arrayContaining([[teamB, 6, 1], [teamA, 8, 2]]));
  }, 60_000);

  it("A STROKE GAME STILL PRODUCES INDIVIDUAL ROWS — the control", async () => {
    /**
     * Without this the absence above would also pass against a finalize that
     * wrote nothing at all, or against a build that broke user rows for every
     * format. Same helper, same competition shape, same finalize — only the game
     * type differs, which is the one variable under test.
     */
    const comp = await ctx.createCompetition(tripId, "Stroke Control Cup", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Solo", { shortName: "SOL" });
    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamA },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE_PLAY, name: "Stroke Control", competitionId: comp,
    })) as { id: string };
    // Two players: `addParticipants` requires >= 2, and a one-person control
    // would not exercise the individual rows this test exists to find.
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    for (const [pid, v] of [[owner, 5], [planner, 7]] as [string, number][]) {
      await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: pid, unitLabel: "1", value: v });
    }
    await completeRound(ctx, game.id, "user", [[owner, 0], [planner, 0]], owner);
    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score")
      .eq("game_id", game.id);

    const users = (rows ?? []).filter((r) => r.entity_type === "user");
    expect(users.map((r) => [r.entity_id, r.raw_score] as [string, number]).sort()).toEqual(
      [[owner, 5], [planner, 7]].sort()
    );
    // And no group rows, which is the mirror image of the scramble case.
    expect((rows ?? []).filter((r) => r.entity_type === "play_group")).toEqual([]);
  }, 60_000);
});
