import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { gameFinishedMessage } from "./gameFinishNotify";

/**
 * PR 7 — a TEAMLESS points race: a points race with no teams, whose units are
 * people (rulings 5, 6, 22; a race plays as teams iff it has them, ruling B).
 * Asserted through the real write paths (`games.finish`, `matchOutcomes`,
 * `matches.setPairings`) and the real board (`competitions.leaderboard`).
 *
 *  - a stroke round and a match round produce PER-PERSON standings (the plan's
 *    own test), with the match paying its points to the person (ruling 7);
 *  - a player in the race with no finished result is a unit with NO POINTS YET,
 *    distinguishable from a 0 (ruling 30);
 *  - THE CONTROL: in a TEAMED race the person rows every writer also produces
 *    are never credited — no player is paid twice (the double count);
 *  - the doors: a team-paying format and a 2v2 side are refused, naming what
 *    to do; the game-final push names the winner through the side-game reader.
 *
 * Every case builds its own trip; nothing one writes is another's start state.
 */

let ctx: TestContext;
let owner: string, member: string, planner: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  planner = ctx.getUser("planner").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** 18 holes for each player at a fixed score, then the one finalize. */
async function finishStroke(tripId: string, gameId: string, scores: [string, number][]): Promise<void> {
  const parts = await ctx.admin
    .from("game_participants")
    .insert(scores.map(([uid]) => ({ id: genId("gp"), game_id: gameId, user_id: uid })));
  if (parts.error) throw new Error(`seed participants: ${parts.error.message}`);
  await ctx.groupStrokeParticipants(gameId, scores.map(([uid]) => uid));
  const rows = scores.flatMap(([uid, v]) =>
    Array.from({ length: 18 }, (_, i) => ({
      id: genId("se"), game_id: gameId, participant_id: uid, participant_type: "user",
      unit_label: String(i + 1), value: v, submitted_by: uid,
    }))
  );
  const ins = await ctx.admin.from("score_entries").insert(rows);
  if (ins.error) throw new Error(`seed scores: ${ins.error.message}`);
  await ctx.caller().games.finish({ tripId, gameId });
}

/** A 1v1 match, decided hole by hole through the real outcome mutation: A wins 3&2. */
async function finishMatch(tripId: string, gameId: string, a: string, b: string): Promise<void> {
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
  const matches = await ctx.caller().matches.setPairings({
    tripId, gameId,
    matches: [{ playersPerSide: 1, sideA: { members: [a] }, sideB: { members: [b] }, matchNumber: 1 }],
  });
  const matchId = (matches as { id: string }[])[0].id;
  await ctx.caller().games.enableScoring({ tripId, gameId });
  for (let h = 1; h <= 3; h++) {
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "side_a" });
  }
  for (let h = 4; h <= 16; h++) {
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "halved" });
  }
  await ctx.caller().games.finish({ tripId, gameId });
}

describe("a teamless race", () => {
  it("a stroke round and a match round produce per-person standings, and a player yet to finish has no points yet", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Teamless race", scoringModel: "points", members: ["member", "planner", "outsider"],
    });

    // Stroke: owner 4s, member 5s, planner 6s → 1st, 2nd, 3rd → 6, 3, 1.
    const stroke = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_stroke_play", name: "Round 1", competitionId,
      pointsDistribution: { type: "placement", values: [6, 3, 1] },
    })) as { id: string };
    await finishStroke(tripId, stroke.id, [[owner, 4], [member, 5], [planner, 6]]);

    // Match: owner beats member 3&2, worth 4. The planner is not in it.
    const match = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_match_play", name: "Singles", competitionId,
      pointsDistribution: { type: "per_match", value: 4 },
    })) as { id: string };
    await finishMatch(tripId, match.id, owner, member);

    // The outsider is IN a game that has not finished: a unit, no points yet.
    const later = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_stroke_play", name: "Round 2", competitionId,
      pointsDistribution: { type: "placement", values: [6, 3, 1] },
    })) as { id: string };
    const part = await ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: later.id, user_id: outsider });
    if (part.error) throw new Error(`seed participant: ${part.error.message}`);

    // The match paid the PERSON, as points with no position (the shape the board
    // can rank; a points row that carries a position ranks nothing).
    const { data: matchRows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score, position, value_kind")
      .eq("game_id", match.id);
    expect(
      (matchRows ?? []).map((r) => [r.entity_type, r.entity_id, Number(r.raw_score), r.position, r.value_kind]).sort()
    ).toEqual([
      ["user", member, 0, null, "points"],
      ["user", owner, 4, null, "points"],
    ].sort());

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(lb.teamless).toBe(true);
    expect(lb.units.every((u) => u.kind === "person")).toBe(true);
    expect(lb.units.map((u) => u.id).sort()).toEqual([owner, member, planner, outsider].sort());
    // EXACT per-person totals: stroke placement + the match's points.
    expect(lb.unitTotals).toEqual({ [owner]: 6 + 4, [member]: 3 + 0, [planner]: 1, [outsider]: 0 });
    // The outsider's 0 is NOT a result: no points yet, and the board is told so.
    const hasResult = Object.fromEntries(lb.units.map((u) => [u.id, u.hasResult]));
    expect(hasResult).toEqual({ [owner]: true, [member]: true, [planner]: true, [outsider]: false });
    // "Places paid" counts units, not teams (there are none): the stroke pool is
    // its whole split, and the match counts what it paid. The live round adds
    // nothing banked.
    expect(lb.pointsAvailable).toBe(10 + 4 + 10);
    // The completed games name their winners (ruling C), by trip display name.
    const winnersOf = (id: string) => (lb.games.find((g) => g.id === id) as { winners?: string[] } | undefined)?.winners;
    const ownerName = lb.units.find((u) => u.id === owner)!.name;
    expect(winnersOf(stroke.id)).toEqual([ownerName]);
    expect(winnersOf(match.id)).toEqual([ownerName]);
    expect(winnersOf(later.id)).toBeUndefined();

    // The push names the winner too, through the same reader (ruling 5).
    const { message } = await gameFinishedMessage(ctx.admin, {
      tripId, gameId: match.id, gameName: "Singles", gameTypeId: "gtt_match_play",
      competitionId, strategy: "match_play", actorUserId: owner,
    });
    expect(message.body).toBe(`Won by ${ownerName}`);
  }, 120_000);

  it("refuses a team-paying format, naming the formats that work and the other way out", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "Teamless doors", scoringModel: "points" });
    await expect(
      ctx.caller().games.create({ tripId, gameTypeId: "gtt_pickem", name: "Slate", competitionId })
    ).rejects.toMatchObject({
      message: "Pick'em pays teams, and this race is played as individuals. Pick one of Stroke Play, Match Play, Skins, or add teams to the race first.",
    });
    // CONTROL: a per-person format is admitted to the same race.
    await expect(
      ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Round", competitionId })
    ).resolves.toBeTruthy();
  }, 60_000);

  it("refuses a 2v2 side, saying why in a race with no teams (ruling 3)", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "Teamless pairs", scoringModel: "points", members: ["member", "planner", "outsider"],
    });
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_match_play", name: "Fourball", competitionId,
    })) as { id: string };
    await expect(
      ctx.caller().matches.setPairings({
        tripId, gameId: g.id,
        matches: [{ playersPerSide: 2, sideA: { members: [owner, member] }, sideB: { members: [planner, outsider] }, matchNumber: 1 }],
      })
    ).rejects.toMatchObject({
      message: "This race is played as individuals, so each side of a match is one player until split payouts are supported. Pair them as singles.",
    });
  }, 60_000);
});

describe("creating a race played as individuals (rulings 21, 22)", () => {
  it("a points race created with no teams seeds none and is teamless; one team is refused", async () => {
    const tripId = await ctx.createTrip("Individuals race");
    const created = (await ctx.caller().competitions.create({
      tripId, name: "Buddy Open", scoringModel: "points", teamCount: 0,
    })) as { id: string };
    const { count } = await ctx.admin.from("teams").select("id", { count: "exact", head: true }).eq("competition_id", created.id);
    expect(count).toBe(0);
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: created.id });
    expect(lb.teamless).toBe(true);
    expect(lb.units).toEqual([]);

    // One team is not a race, and not "individuals" either.
    const other = await ctx.createTrip("One-team race");
    await expect(
      ctx.caller().competitions.create({ tripId: other, name: "Lonely Open", scoringModel: "points", teamCount: 1 })
    ).rejects.toThrow(/individuals \(no teams\) or by two or more teams/);
    // CONTROL: head to head still seeds its two, whatever count is asked for.
    const h2hTrip = await ctx.createTrip("H2H race");
    const h2h = (await ctx.caller().competitions.create({
      tripId: h2hTrip, name: "Ryder", scoringModel: "match_play", teamCount: 0,
    })) as { id: string };
    const { count: h2hTeams } = await ctx.admin.from("teams").select("id", { count: "exact", head: true }).eq("competition_id", h2h.id);
    expect(h2hTeams).toBe(2);
  }, 60_000);
});

describe("switching between teams and individuals (rulings B, 23)", () => {
  it("deleting the LAST team is refused while a team-paying game is in the race, naming it", async () => {
    const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
      name: "Last team", scoringModel: "points", teams: ["Solo"],
    });
    await ctx.caller().games.create({ tripId, gameTypeId: "gtt_pickem", name: "Sunday slate", competitionId });
    await expect(ctx.caller().teams.delete({ tripId, teamId: teamIds[0] })).rejects.toMatchObject({
      message: "Without teams this race is played as individuals, and Sunday slate pays teams. Remove that game first, or keep a team.",
    });
    // CONTROL: the same delete with only a per-person game in the race goes
    // through, and leaves a teamless race.
    const other = await ctx.createCupTrip({ name: "Last team, stroke only", scoringModel: "points", teams: ["Solo"] });
    await ctx.caller().games.create({ tripId: other.tripId, gameTypeId: "gtt_stroke_play", name: "Round", competitionId: other.competitionId });
    await expect(ctx.caller().teams.delete({ tripId: other.tripId, teamId: other.teamIds[0] })).resolves.toMatchObject({ success: true });
    const lb = await ctx.caller().competitions.leaderboard({ tripId: other.tripId, competitionId: other.competitionId });
    expect(lb.teamless).toBe(true);
  }, 60_000);

  it("adding the FIRST team is refused once the race has a result, and admitted before", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "First team", scoringModel: "points", members: ["member"],
    });
    // CONTROL first: before any result, a teamless race may become a teamed one.
    const early = await ctx.createCupTrip({ name: "First team, early", scoringModel: "points" });
    await expect(
      ctx.caller().teams.create({ tripId: early.tripId, competitionId: early.competitionId, name: "Blue", shortName: "BLU", color: "blue", colorDim: "blue-dim" })
    ).resolves.toBeTruthy();

    const stroke = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_stroke_play", name: "Round 1", competitionId,
      pointsDistribution: { type: "placement", values: [6, 3] },
    })) as { id: string };
    await finishStroke(tripId, stroke.id, [[owner, 4], [member, 5]]);
    await expect(
      ctx.caller().teams.create({ tripId, competitionId, name: "Blue", shortName: "BLU", color: "blue", colorDim: "blue-dim" })
    ).rejects.toMatchObject({
      message: "This race is played as individuals and already has results, so it can't switch to teams: that would null everyone's points. Reset the race's scores in its settings first.",
    });
  }, 120_000);
});

describe("a TEAMED race is unchanged (the control)", () => {
  /**
   * Stroke writes a person row for every player AND a team row per team. In a
   * teamed race only the team rows are units, so the board must read what it
   * read before PR 7: the teams, exactly. A build that credited person rows here
   * would pay each player once as themselves and again through their team.
   */
  it("person rows are never credited: the units are the teams, with the teams' totals", async () => {
    const { tripId, competitionId, teamIds } = await ctx.createCupTrip({
      name: "Teamed race", scoringModel: "points", members: ["member"], teams: ["Blue", "Red"],
    });
    const [blue, red] = teamIds;
    await ctx.assignTeam(competitionId, blue, [owner]);
    await ctx.assignTeam(competitionId, red, [member]);
    const stroke = (await ctx.caller().games.create({
      tripId, gameTypeId: "gtt_stroke_play", name: "Round 1", competitionId,
      pointsDistribution: { type: "placement", values: [6, 3] },
    })) as { id: string };
    await finishStroke(tripId, stroke.id, [[owner, 4], [member, 5]]);

    // The person rows exist, which is what makes this a control and not a vacuum.
    const { count: personRows } = await ctx.admin
      .from("game_results").select("id", { count: "exact", head: true })
      .eq("game_id", stroke.id).eq("entity_type", "user");
    expect(personRows).toBe(2);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId });
    expect(lb.teamless).toBe(false);
    expect(lb.units.map((u) => [u.kind, u.id])).toEqual([["team", blue], ["team", red]]);
    expect(lb.unitTotals).toEqual({ [blue]: 6, [red]: 3 });
    // The one-release names carry the same values (version skew, see the payload).
    expect(lb.teamTotals).toEqual(lb.unitTotals);
    expect(lb.projectedTeamTotals).toEqual(lb.projectedUnitTotals);
    expect(lb.cells.every((c) => c.teamId === c.unitId)).toBe(true);
    expect(lb.pointsAvailable).toBe(9);
  }, 120_000);
});
