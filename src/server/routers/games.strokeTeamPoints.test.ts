import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * A finalized stroke game must reach the CUP.
 *
 * The regression, observed in the field: a stroke game inside a competition was
 * played, finalized, and contributed nothing — the board stayed empty. Cause was
 * not the UI. `computeStrokePlayResults` wrote `entity_type='user'` rows only
 * (its own doc comment said "standalone game"), while
 * `competitionLeaderboard.ts` reads `game_results` filtered
 * `.eq("entity_type","team")`. Rack and match had always written team rows;
 * stroke never learned the competition half.
 *
 * `strokeTeamStandings.test.ts` pins the aggregation rule in isolation. THIS file
 * pins the part that unit test cannot reach: that finalizing through the real
 * `games.finish` actually persists team rows, in the shape the leaderboard reads.
 * The two failures are different — the rule can be perfect while nothing writes
 * it — and only this one reproduces what was seen.
 */

const STROKE_PLAY = "gtt_stroke_play";

const ROUND = 18;

/**
 * Fill holes 2..18 for each player so they COMPLETE the round.
 *
 * Qualification (the "BBMI Playground" corruption) means only a player who has
 * scored every unit is recorded — an unscored player totalling 0 used to rank
 * first under lowest-wins. These tests are about the TEAM AGGREGATION, so the
 * per-hole path is exercised once through `scores.upsertEntry` and the rest is
 * bulk-inserted; entering 18 holes per player through tRPC would be ~70 round
 * trips for no additional coverage.
 */
async function completeRound(
  ctx: TestContext,
  gameId: string,
  perPlayerFill: [string, number][]
) {
  const rows = perPlayerFill.flatMap(([pid, value]) =>
    Array.from({ length: ROUND - 1 }, (_, i) => ({
      id: crypto.randomUUID(),
      game_id: gameId,
      participant_id: pid,
      participant_type: "user",
      unit_label: String(i + 2),
      value,
      annotations: {},
      submitted_by: pid,
      submitted_at: new Date().toISOString(),
    }))
  );
  await ctx.admin.from("score_entries").insert(rows);
}


let ctx: TestContext;
let tripId: string;

describe("stroke play — team aggregate net reaches game_results", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Stroke Team Points Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("writes team rows ranked lowest-total-first, alongside the per-player rows", async () => {
    const comp = await ctx.createCompetition(tripId, "Stroke Cup", { scoringModel: "points" });
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
      tripId,
      gameTypeId: STROKE_PLAY,
      name: "Team Stroke",
      competitionId: comp,
    })) as { id: string };

    await ctx.caller().games.addParticipants({
      tripId,
      gameId: game.id,
      userIds: [owner, planner, member, outsider],
    });
    await ctx.groupStrokeParticipants(game.id, [owner, planner, member, outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    // Hole 1 carries the whole score; holes 2–18 are zero-filled so every player
    // COMPLETES the round and therefore qualifies. Totals stay exactly as the
    // assertions below expect:
    //   Alpha: owner 8,  planner 10 → 18
    //   Bravo: member 6, outsider 8 → 14   (Bravo lower ⇒ Bravo wins)
    const holeOne: [string, number][] = [[owner, 8], [planner, 10], [member, 6], [outsider, 8]];
    for (const [participantId, value] of holeOne) {
      await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId, unitLabel: "1", value });
    }
    await completeRound(ctx, game.id, [[owner, 0], [planner, 0], [member, 0], [outsider, 0]]);

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: teamRows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score, position")
      .eq("game_id", game.id)
      .eq("entity_type", "team")
      .order("position", { ascending: true });

    // The assertion that would have caught the field bug: this used to be [].
    expect(teamRows).toHaveLength(2);
    expect(teamRows![0]).toMatchObject({ entity_id: teamB, raw_score: 14, position: 1 });
    expect(teamRows![1]).toMatchObject({ entity_id: teamA, raw_score: 18, position: 2 });

    // The per-player rows are unchanged — team rows are additive, not a swap.
    const { data: userRows } = await ctx.admin
      .from("game_results")
      .select("entity_id")
      .eq("game_id", game.id)
      .eq("entity_type", "user");
    expect(userRows).toHaveLength(4);
  });

  it("a team with nobody in the game gets NO row — an absent team must not win", async () => {
    // Under lowest-total-wins, a row for an absent team would carry total 0 and
    // beat everyone. The most dangerous edge in the whole rule, so it is pinned
    // against the real writer and not only against the pure function.
    const comp = await ctx.createCompetition(tripId, "Lopsided Cup", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Present", { shortName: "PRS" });
    const teamGhost = await ctx.createTeam(comp, "Absent", { shortName: "ABS" });

    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    const member = ctx.getUser("member").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamA },
      // `member` is assigned to the absent team but never added to the game.
      { competition_id: comp, user_id: member, team_id: teamGhost },
    ]);

    const game = (await ctx.caller().games.create({
      tripId,
      gameTypeId: STROKE_PLAY,
      name: "Lopsided",
      competitionId: comp,
    })) as { id: string };
    // addParticipants requires 2–4 users, so Alpha fields two; the point is that
    // the OTHER team fields nobody.
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    for (const [participantId, value] of [[owner, 5], [planner, 6]] as [string, number][]) {
      await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId, unitLabel: "1", value });
    }
    await completeRound(ctx, game.id, [[owner, 0], [planner, 0]]);

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: teamRows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score, position")
      .eq("game_id", game.id)
      .eq("entity_type", "team");

    expect(teamRows).toHaveLength(1);
    expect(teamRows![0]).toMatchObject({ entity_id: teamA, raw_score: 11, position: 1 });
    expect(teamRows!.map((r) => r.entity_id)).not.toContain(teamGhost);
  });

  it("an unscored team-mate does NOT create a zero-total team row", async () => {
    // The production corruption, reproduced end to end: "BBMI Playground
    // (Points)" / Test1 had ONE player complete 18 holes and seven rostered
    // team-mates who never teed off. Finalize recorded three teams tied for
    // FIRST on totals of 0, with the only team that actually played placed 4th.
    const comp = await ctx.createCompetition(tripId, "Ghost Cup", { scoringModel: "points" });
    const played = await ctx.createTeam(comp, "Played", { shortName: "PLY" });
    const idle = await ctx.createTeam(comp, "Idle", { shortName: "IDL" });

    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: played },
      { competition_id: comp, user_id: planner, team_id: idle },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE_PLAY, name: "Ghosts", competitionId: comp,
    })) as { id: string };
    // BOTH are participants — this is the axis the original guard missed. The
    // roster is complete; it is the SCORES that are absent.
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: owner, unitLabel: "1", value: 5 });
    await completeRound(ctx, game.id, [[owner, 0]]); // planner deliberately never scores

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: teamRows } = await ctx.admin
      .from("game_results").select("entity_id, raw_score, position")
      .eq("game_id", game.id).eq("entity_type", "team");
    expect(teamRows).toHaveLength(1);
    expect(teamRows![0]).toMatchObject({ entity_id: played, raw_score: 5, position: 1 });

    // …and the unscored player gets no per-player row either. He used to get
    // `rawScore 0, position 1` — ahead of the player who actually shot 5.
    const { data: userRows } = await ctx.admin
      .from("game_results").select("entity_id, position")
      .eq("game_id", game.id).eq("entity_type", "user");
    expect(userRows).toHaveLength(1);
    expect(userRows![0]).toMatchObject({ entity_id: owner, position: 1 });
  });

  it("finalize REFUSES when nobody completed the round", async () => {
    // Previously this recorded a result in which every player tied for first on
    // zero. Refusing is the only honest answer, and #801 is what makes the
    // reason visible instead of vanishing into an empty catch.
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE_PLAY, name: "Rained Off",
    })) as { id: string };
    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    // Nine holes in — a real rainout, not an empty game.
    await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId: owner, unitLabel: "1", value: 4 });

    await expect(ctx.caller().games.finish({ tripId, gameId: game.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // Refused means refused: no rows, and the game is NOT marked complete.
    const { data: rows } = await ctx.admin.from("game_results").select("id").eq("game_id", game.id);
    expect(rows ?? []).toHaveLength(0);
    const { data: g } = await ctx.admin.from("games").select("status").eq("id", game.id).single();
    expect((g as { status: string }).status).not.toBe("complete");
  });

  it("a STANDALONE stroke game still writes user rows only", async () => {
    // The shape before this change, preserved exactly. No competition means no
    // assignments, so the team half is inert rather than special-cased — worth a
    // test because "competition games gained rows" and "standalone games gained
    // rows" are one line apart.
    const game = (await ctx.caller().games.create({
      tripId,
      gameTypeId: STROKE_PLAY,
      name: "Solo Round",
    })) as { id: string; competition_id: string | null };
    expect(game.competition_id).toBeNull();

    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    for (const [participantId, value] of [[owner, 4], [planner, 5]] as [string, number][]) {
      await ctx.caller().scores.upsertEntry({ tripId, gameId: game.id, participantId, unitLabel: "1", value });
    }
    await completeRound(ctx, game.id, [[owner, 0], [planner, 0]]);
    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_type")
      .eq("game_id", game.id);
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.entity_type === "user")).toBe(true);
  });
});
