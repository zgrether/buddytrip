import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * SKINS, end to end through `games.finish`.
 *
 * The pure fold is covered exhaustively in `src/lib/skins.test.ts`, including
 * both mutation-checked headline cases. What is asserted HERE is everything that
 * only exists once the server is involved:
 *
 *   · the carryover reaches `game_results` intact — the arithmetic the engine
 *     computes is the arithmetic that gets banked;
 *   · MORE IS BETTER survives the round trip. Skins ranks through the same
 *     `ranking()` mapping stroke play uses, whose default is lowest-wins, so a
 *     board ranked upside down is the single most likely way this ships broken
 *     and nothing in the pure tests would catch a wrong `ScoringType` reaching
 *     `computeStrokeTeamStandings`;
 *   · a skin lands on the WINNER'S team, which is the whole of the roll-up
 *     claim, and cannot be checked without real `team_assignments`;
 *   · the groupings stay INDEPENDENT across the persistence boundary — the case
 *     a single-grouping fixture cannot show, and the one the format exists for.
 */

const SKINS = "gtt_skins";
const ROUND = 18;

let ctx: TestContext;
let tripId: string;

/** Record one hole for a grouping, as the service role. Who MAY write is
 *  `skinsHoleOutcomes.rls.test.ts`'s subject, not this file's. */
async function hole(
  gameId: string,
  groupingId: string,
  holeNumber: number,
  winnerId: string | null,
  submittedBy: string
) {
  const { error } = await ctx.admin.from("skins_hole_outcomes").insert({
    id: genId("sho"),
    game_id: gameId,
    grouping_id: groupingId,
    hole_number: holeNumber,
    result: winnerId ? "won" : "tied",
    winner_user_id: winnerId,
    submitted_by: submittedBy,
  });
  expect(error, `fixture failed to record hole ${holeNumber}`).toBeNull();
}

describe("skins — the carryover reaches the cup", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Skins Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("banks skins per PLAYER, ranked high-first, and rolls them up to the right teams", async () => {
    const comp = await ctx.createCompetition(tripId, "Skins Cup", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });

    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    const member = ctx.getUser("member").id;
    const outsider = ctx.getUser("outsider").id;

    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamB },
      { competition_id: comp, user_id: member, team_id: teamA },
      { competition_id: comp, user_id: outsider, team_id: teamB },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "The Skins", competitionId: comp,
    })) as { id: string };
    await ctx.caller().games.addParticipants({
      tripId, gameId: game.id, userIds: [owner, planner, member, outsider],
    });

    // TWO groupings — one owner+planner, one member+outsider. Two independent
    // contests, which is the shape the format is for.
    const g1 = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    const g2 = await ctx.groupStrokeParticipants(game.id, [member, outsider]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    // ── Grouping 1: a tie on 2, so 3 is worth 2 and planner takes it ───────
    // Everything else to owner, so the totals are unambiguous.
    await hole(game.id, g1, 1, owner, owner);
    await hole(game.id, g1, 2, null, owner); // tied — carries
    await hole(game.id, g1, 3, planner, owner); // 1 of its own + 1 carried = 2
    for (let h = 4; h <= ROUND; h++) await hole(game.id, g1, h, owner, owner);

    // ── Grouping 2: NO ties. Its pots must be untouched by grouping 1's. ───
    for (let h = 1; h <= ROUND; h++) await hole(game.id, g2, h, member, owner);

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score, position")
      .eq("game_id", game.id);

    const byUser = new Map(
      (rows ?? []).filter((r) => r.entity_type === "user").map((r) => [r.entity_id as string, r])
    );

    // Grouping 1 played for 18 (no glorious): owner took 16 holes, planner one
    // hole worth 2, and the tie paid nobody at the time it happened.
    expect(byUser.get(owner)?.raw_score, "owner's skins").toBe(16);
    expect(byUser.get(planner)?.raw_score, "planner's carried hole should be worth 2").toBe(2);

    // Grouping 2's pots are untouched by grouping 1's tie — every hole worth
    // exactly 1. A build with ONE shared carryover state inflates these.
    expect(byUser.get(member)?.raw_score, "grouping 2 inherited a carry it never had").toBe(18);
    expect(byUser.get(outsider)?.raw_score).toBe(0);

    // MORE IS BETTER. Under stroke play's default direction this comes back
    // inverted — outsider on 0 would be 1st.
    expect(byUser.get(member)?.position, "18 skins should rank ahead of 16").toBe(1);
    expect(byUser.get(owner)?.position).toBe(2);
    expect(byUser.get(planner)?.position).toBe(3);
    expect(byUser.get(outsider)?.position).toBe(4);

    // The roll-up. Alpha = owner 16 + member 18 = 34; Bravo = planner 2 +
    // outsider 0 = 2. A skin belongs to the person, and lands on THEIR team.
    const byTeam = new Map(
      (rows ?? []).filter((r) => r.entity_type === "team").map((r) => [r.entity_id as string, r])
    );
    expect(byTeam.get(teamA)?.raw_score).toBe(34);
    expect(byTeam.get(teamB)?.raw_score).toBe(2);
    expect(byTeam.get(teamA)?.position, "the higher team total should rank first").toBe(1);
    expect(byTeam.get(teamB)?.position).toBe(2);

    // Everything a skins game produces is a person or a team. No play_group rows
    // — the grouping is the CONTEST, not a competitor, and banking one would put
    // a boundary into a column every reader treats as an entrant.
    expect((rows ?? []).filter((r) => r.entity_type === "play_group")).toEqual([]);
  }, 60_000);

  it("A TIED LAST HOLE PAYS NOBODY, all the way through to the banked rows", async () => {
    /**
     * The pure test already pins that the fold destroys the pot. This pins that
     * the destruction survives the persist: the awarded total is short by
     * exactly what was on the table, and nothing quietly redistributed it.
     */
    const comp = await ctx.createCompetition(tripId, "Skins Dead Pot", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Solo", { shortName: "SOL" });
    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamA },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "Dead Pot", competitionId: comp,
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    const g = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    for (let h = 1; h <= 16; h++) await hole(game.id, g, h, owner, owner);
    await hole(game.id, g, 17, null, owner); // tied — carries 1
    await hole(game.id, g, 18, null, owner); // tied on the last — 2 destroyed

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score")
      .eq("game_id", game.id);
    const byUser = new Map(
      (rows ?? []).filter((r) => r.entity_type === "user").map((r) => [r.entity_id as string, r])
    );

    // 16 of the 18 skins were won; the other 2 sat on the last hole and went
    // nowhere. Not split, not rolled, not quietly awarded to the leader.
    expect(byUser.get(owner)?.raw_score).toBe(16);
    expect(byUser.get(planner)?.raw_score).toBe(0);
    const teamRow = (rows ?? []).find((r) => r.entity_type === "team");
    expect(teamRow?.raw_score, "the destroyed pot must not reappear in the roll-up").toBe(16);
  }, 60_000);

  it("no stroke scores are written or read — the format has none", async () => {
    /**
     * The absence that defines this format, asserted where a hidden one would
     * still leave a trace. A build that derived skins from strokes, or that
     * quietly wrote `score_entries` alongside, fails here even though every
     * number above would still be right.
     */
    const comp = await ctx.createCompetition(tripId, "Skins No Strokes", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Solo2", { shortName: "SO2" });
    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamA },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "No Strokes", competitionId: comp,
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    const g = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    for (let h = 1; h <= ROUND; h++) await hole(game.id, g, h, owner, owner);
    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { count } = await ctx.admin
      .from("score_entries")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game.id);
    expect(count ?? 0).toBe(0);

    // …and the game still banked a real result, so the zero above is an absence
    // rather than a finalize that did nothing.
    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score")
      .eq("game_id", game.id)
      .eq("entity_type", "user");
    expect((rows ?? []).find((r) => r.entity_id === owner)?.raw_score).toBe(18);
  }, 60_000);

it("AN UNPLAYED GAME BANKS NOTHING — it must not pay the pot out evenly", async () => {
    /**
     * The bug, and it reached a real cup board: a skins game sitting in
     * CONFIGURING ("Ready — enable scoring") was awarding 5 · 5 · 5 · 5 of its 20
     * points to four teams that had not played it.
     *
     * The mechanism is not the leaderboard. `computeSkinsResults` emitted a row
     * for EVERY grouped participant regardless of whether anything had been
     * recorded, so an unplayed game produced N standings all on 0 skins and all
     * at `position: 1`. `rollUp` then read four teams TIED FOR FIRST and
     * `placementPoints` averaged the whole distribution across them — which is
     * the correct behaviour for a genuine four-way tie and nonsense for a game
     * nobody has played.
     *
     * It fires on the SETUP path, not the finalize: `games.saveConfig` recomputes
     * results after every settings Save (the arm stroke and rack use), so simply
     * configuring the game published a full set of awardable rows.
     *
     * Asserting the ABSENCE of rows is what makes this real. A test that checked
     * the leaderboard total would pass against a build that wrote the rows and
     * happened to display them differently.
     */
    const comp = await ctx.createCompetition(tripId, "Skins Unplayed", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Alpha2", { shortName: "AL2" });
    const teamB = await ctx.createTeam(comp, "Bravo2", { shortName: "BR2" });
    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamB },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "Unplayed Skins", competitionId: comp,
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId, gameId: game.id, userIds: [owner, planner] });
    await ctx.groupStrokeParticipants(game.id, [owner, planner]);

    // The setup-path recompute, through the same procedure the settings page
    // calls. No hole has been recorded.
    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score, position")
      .eq("game_id", game.id);

    expect(
      rows ?? [],
      "an unplayed skins game must bank no results — every row here is points the cup will pay out"
    ).toEqual([]);
  }, 60_000);

  it("…and a PARTLY played one banks only the groups that have played", async () => {
    /**
     * The other half, and the control: the fix must not be "write nothing until
     * every group is done". A group thru a few holes has genuinely won those
     * pots; a group that has not teed off has won nothing and is not on 0, it is
     * absent.
     *
     * That is the rule `StrokeTeamTotals` already states for its own board — "a
     * team with nobody playing yet gets NO row rather than a row totalling zero"
     * — applied to what gets BANKED rather than what gets drawn.
     */
    const comp = await ctx.createCompetition(tripId, "Skins Partial", { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Alpha3", { shortName: "AL3" });
    const teamB = await ctx.createTeam(comp, "Bravo3", { shortName: "BR3" });
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
      tripId, gameTypeId: SKINS, name: "Partial Skins", competitionId: comp,
    })) as { id: string };
    await ctx.caller().games.addParticipants({
      tripId, gameId: game.id, userIds: [owner, planner, member, outsider],
    });
    const played = await ctx.groupStrokeParticipants(game.id, [owner, planner]);
    await ctx.groupStrokeParticipants(game.id, [member, outsider]); // never tees off
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await hole(game.id, played, 1, owner, owner);

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score")
      .eq("game_id", game.id);
    const users = (rows ?? []).filter((r) => r.entity_type === "user").map((r) => r.entity_id);

    expect(users.sort(), "only the group that played is banked").toEqual([owner, planner].sort());
    // …and the untouched group's TEAM gets no row either, rather than a zero that
    // would read as "played and won nothing".
    const teams = (rows ?? []).filter((r) => r.entity_type === "team").map((r) => r.entity_id);
    expect(teams).toEqual([teamA]);
  }, 60_000);

  it("the game is reported as STARTED once a hole is recorded", async () => {
    /**
     * Migration 186's arm, from the caller's side. `game_started` is what the
     * board splits Ready-for-Play from underway on, and what both removal guards
     * read — and a skins game writes none of the four tables the view knew about
     * before, so without the arm a game seventeen holes in reports as untouched
     * (CLAUDE.md #27).
     *
     * The pre-condition is asserted first so a view that returned every game
     * would fail rather than pass.
     */
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SKINS, name: "Started Probe",
    })) as { id: string };
    await ctx.caller().games.addParticipants({
      tripId, gameId: game.id, userIds: [ctx.getUser("owner").id, ctx.getUser("planner").id],
    });
    const g = await ctx.groupStrokeParticipants(game.id, [ctx.getUser("owner").id]);

    const before = await ctx.admin.from("game_started").select("game_id").eq("game_id", game.id);
    expect(before.data ?? [], "an unplayed game must not read as started").toEqual([]);

    await hole(game.id, g, 1, null, ctx.getUser("owner").id); // a TIE counts — it was played
    const after = await ctx.admin.from("game_started").select("game_id").eq("game_id", game.id);
    expect((after.data ?? []).length, "a recorded tie should mark the game started").toBe(1);
  }, 60_000);
});
