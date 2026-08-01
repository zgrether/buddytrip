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

    // Two holes each, with per-player and per-team totals all distinct so a
    // swapped rank or a mis-summed team cannot pass by coincidence:
    //   Alpha: owner 4+4=8,  planner 5+5=10  → 18
    //   Bravo: member 3+3=6, outsider 4+4=8  → 14   (Bravo lower ⇒ Bravo wins)
    const holes: [string, string, number][] = [
      [owner, "1", 4], [owner, "2", 4],
      [planner, "1", 5], [planner, "2", 5],
      [member, "1", 3], [member, "2", 3],
      [outsider, "1", 4], [outsider, "2", 4],
    ];
    for (const [participantId, unitLabel, value] of holes) {
      await ctx.caller().scores.upsertEntry({
        tripId,
        gameId: game.id,
        participantId,
        unitLabel,
        value,
      });
    }

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
    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_type")
      .eq("game_id", game.id);
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.entity_type === "user")).toBe(true);
  });
});
