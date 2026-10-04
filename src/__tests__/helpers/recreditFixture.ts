import type { TestContext } from "./test-setup";

/**
 * A finished stroke round in a points cup, for the re-credit tests (PR 8c).
 *
 * Alpha = owner + planner, Bravo = member + outsider. Hole 1 carries the score
 * (owner 5, planner 6, member 4, outsider 4); holes 2..18 are 0 so the round
 * completes. The game pays 10 to the winning team and 4 to the other, so a
 * re-credit that flips the result moves real points.
 *
 * Totals as finalized: Alpha 11, Bravo 8 (Bravo wins, low wins). Through a
 * roster with the planner on Bravo: Alpha 5, Bravo 14.
 *
 * Every caller builds its own cup — these are destructive writes (CLAUDE.md).
 */

const STROKE = "gtt_stroke_play";
const ROUND = 18;

export function recreditFixture(ctx: TestContext) {
  const owner = ctx.getUser("owner").id;
  const planner = ctx.getUser("planner").id;
  const member = ctx.getUser("member").id;
  const outsider = ctx.getUser("outsider").id;

  async function strokeGame(tripId: string, competitionId: string, name: string): Promise<string> {
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name, competitionId })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner, member, outsider] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner, member, outsider]);
    const dist = await ctx.admin
      .from("games")
      .update({ points_distribution: { type: "placement", values: [10, 4] }, points_total: 14 })
      .eq("id", game.id);
    if (dist.error) throw dist.error;
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    return game.id;
  }

  async function playRound(tripId: string, gameId: string) {
    const hole1: [string, number][] = [[owner, 5], [planner, 6], [member, 4], [outsider, 4]];
    for (const [participantId, value] of hole1) {
      await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId, unitLabel: "1", value });
    }
    const rest = await ctx.admin.from("score_entries").insert(
      hole1.flatMap(([pid]) =>
        Array.from({ length: ROUND - 1 }, (_, i) => ({
          id: crypto.randomUUID(), game_id: gameId, participant_id: pid, participant_type: "user",
          unit_label: String(i + 2), value: 0, annotations: {}, submitted_by: owner,
          submitted_at: new Date().toISOString(),
        }))
      )
    );
    if (rest.error) throw rest.error;
  }

  async function finishedGame(tripId: string, competitionId: string, name: string): Promise<string> {
    const gameId = await strokeGame(tripId, competitionId, name);
    await playRound(tripId, gameId);
    await ctx.caller().games.finish({ tripId, gameId });
    return gameId;
  }

  async function finishedCup(name: string) {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name, scoringModel: "points",
      members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
    });
    const alpha = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
    const bravo = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
    const ins = await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: owner, team_id: alpha },
      { competition_id: competitionId, user_id: planner, team_id: alpha },
      { competition_id: competitionId, user_id: member, team_id: bravo },
      { competition_id: competitionId, user_id: outsider, team_id: bravo },
    ]);
    if (ins.error) throw ins.error;
    const gameId = await finishedGame(tripId, competitionId, `${name} round`);
    return { tripId, competitionId, gameId, alpha, bravo };
  }

  async function teamTotals(gameId: string): Promise<Record<string, number>> {
    const { data, error } = await ctx.admin
      .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
  }

  async function creditedRoster(gameId: string): Promise<Record<string, string>> {
    const { data, error } = await ctx.admin.from("games").select("credited_roster").eq("id", gameId).single();
    if (error) throw error;
    return data.credited_roster as Record<string, string>;
  }

  async function records(gameId: string) {
    const { data, error } = await ctx.admin.from("game_recredits").select("*").eq("game_id", gameId);
    if (error) throw error;
    return data ?? [];
  }

  /** The state a trade (or a removal) leaves; how it got there is not under test. */
  async function moveTo(competitionId: string, userId: string, teamId: string | null) {
    const { error } = teamId
      ? await ctx.admin.from("team_assignments").update({ team_id: teamId }).eq("competition_id", competitionId).eq("user_id", userId)
      : await ctx.admin.from("team_assignments").delete().eq("competition_id", competitionId).eq("user_id", userId);
    if (error) throw error;
  }

  return {
    owner, planner, member, outsider,
    strokeGame, playRound, finishedGame, finishedCup,
    teamTotals, creditedRoster, records, moveTo,
  };
}
