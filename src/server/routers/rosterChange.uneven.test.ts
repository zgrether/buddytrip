import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * #1562 — the trade preview warns when a change would leave an UNFINISHED
 * stroke or skins round with unequal teams (Zach's ruling on #1561: a team
 * total stays a sum; warn, never block).
 *
 * Counted over the round's PARTICIPANTS (a round still being played has no
 * finishers) through the cup's roster AFTER the change. The decisive cases
 * call the preview twice for the same person with two destinations: a tag that
 * appears for one and not the other can only come from the roster after the
 * change, never from the roster as it stands.
 *
 * Every case builds its own cup: the tag is a count, and a shared roster would
 * make one case's players another's.
 */

let ctx: TestContext;
let ownerId: string;
let memberId: string;
let plannerId: string;
let outsiderId: string;

const STROKE_WHY = "In stroke play a team's total adds up its players' strokes, so the bigger team is at a disadvantage.";
const SKINS_WHY = "In skins a team's total adds up its players' skins, so the bigger team is at an advantage.";

type Cup = { tripId: string; competitionId: string; teamA: string; teamB: string };

beforeAll(async () => {
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  memberId = ctx.getUser("member").id;
  plannerId = ctx.getUser("planner").id;
  outsiderId = ctx.getUser("outsider").id;
}, 90_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function insertGame(cup: Cup, fields: Record<string, unknown>): Promise<string> {
  const id = genId("un-game");
  const { error } = await ctx.admin.from("games").insert({
    id, trip_id: cup.tripId, competition_id: cup.competitionId, ...fields,
  });
  if (error) throw new Error(`games insert failed: ${error.message}`);
  return id;
}

async function addParticipants(gameId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    const { error } = await ctx.admin.from("game_participants").insert({ id: genId("gp"), game_id: gameId, user_id: userId });
    if (error) throw new Error(`game_participants insert failed: ${error.message}`);
  }
}

/**
 * A points cup with Team A and Team B, rosters as given, and RESULTS — a
 * scored stroke round ("Locker") the owner alone is in, so the preview is the
 * after-results one. Nobody under test is in Locker.
 */
async function cup(label: string, rosters: { a: string[]; b: string[] }): Promise<Cup> {
  const tripId = await ctx.createTrip(`Uneven ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Uneven Cup ${label}`, { scoringModel: "points" });
  const teamA = await ctx.createTeam(competitionId, "Team A");
  const teamB = await ctx.createTeam(competitionId, "Team B");
  for (const userId of rosters.a) await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId, teamId: teamA });
  for (const userId of rosters.b) await ctx.caller().teamAssignments.assign({ tripId, competitionId, userId, teamId: teamB });
  const c = { tripId, competitionId, teamA, teamB };
  const locker = await insertGame(c, { game_type_id: "gtt_stroke_play", name: "Locker", status: "active" });
  await addParticipants(locker, [ownerId]);
  const { error } = await ctx.admin.from("score_entries").insert({
    id: genId("se"), game_id: locker, participant_id: ownerId, participant_type: "user", unit_label: "1", value: 4,
  });
  if (error) throw new Error(`score_entries insert failed: ${error.message}`);
  expect(await ctx.caller().teamAssignments.hasResults({ tripId, competitionId })).toBe(true);
  return c;
}

const preview = (c: Cup, userId: string, toTeamId: string | null) =>
  ctx.caller().teamAssignments.previewChange({ tripId: c.tripId, competitionId: c.competitionId, userId, toTeamId });

const unevenOf = async (c: Cup, userId: string, toTeamId: string | null, game: string) =>
  (await preview(c, userId, toTeamId)).moving.find((g) => g.name === game)?.uneven;

describe("the trade preview's uneven-teams tag — counted on the roster AFTER the change", () => {
  it("a move that UNBALANCES a stroke round tags it; the same person staying put does not", async () => {
    // Round: member + planner (A), owner + outsider (B) — 2 v 2.
    const c = await cup("unbalance", { a: [memberId, plannerId], b: [ownerId, outsiderId] });
    const round = await insertGame(c, { game_type_id: "gtt_stroke_play", name: "Friday Stroke", status: "active" });
    await addParticipants(round, [memberId, plannerId, ownerId, outsiderId]);

    // Moving the member to B leaves A 1, B 3.
    expect(await unevenOf(c, memberId, c.teamB, "Friday Stroke")).toEqual({
      tag: "Uneven teams: Team B 3, Team A 1",
      explanation: STROKE_WHY,
      consequence: "the bigger team is at a disadvantage",
    });
    // CONTROL: same person, same round, destination = their own team. Even.
    expect(await unevenOf(c, memberId, c.teamA, "Friday Stroke")).toBeNull();
  });

  it("a move that EVENS a round renders no tag — even though the round is uneven now", async () => {
    // Round: member + planner + outsider (A), owner (B) — 3 v 1 today.
    const c = await cup("evens", { a: [memberId, plannerId, outsiderId], b: [ownerId] });
    const round = await insertGame(c, { game_type_id: "gtt_stroke_play", name: "Saturday Stroke", status: "active" });
    await addParticipants(round, [memberId, plannerId, outsiderId, ownerId]);

    // Premise: as the roster stands (the member staying on A) it IS uneven.
    expect(await unevenOf(c, memberId, c.teamA, "Saturday Stroke")).toEqual({
      tag: "Uneven teams: Team A 3, Team B 1",
      explanation: STROKE_WHY,
      consequence: "the bigger team is at a disadvantage",
    });
    // After the move: 2 v 2.
    expect(await unevenOf(c, memberId, c.teamB, "Saturday Stroke")).toBeNull();
  });

  it("skins says the OTHER direction: the bigger team is at an advantage", async () => {
    const c = await cup("skins", { a: [memberId, plannerId], b: [ownerId, outsiderId] });
    const skins = await insertGame(c, { game_type_id: "gtt_skins", name: "Back Nine Skins", status: "active" });
    await addParticipants(skins, [memberId, plannerId, ownerId, outsiderId]);

    expect(await unevenOf(c, memberId, c.teamB, "Back Nine Skins")).toEqual({
      tag: "Uneven teams: Team B 3, Team A 1",
      explanation: SKINS_WHY,
      consequence: "the bigger team is at an advantage",
    });
  });

  it("a REMOVAL from a team counts that team down — to zero, which is the most uneven of all", async () => {
    const c = await cup("removal", { a: [memberId], b: [ownerId] });
    const round = await insertGame(c, { game_type_id: "gtt_stroke_play", name: "Sunday Stroke", status: "active" });
    await addParticipants(round, [memberId, ownerId]);

    expect(await unevenOf(c, memberId, null, "Sunday Stroke")).toEqual({
      tag: "Uneven teams: Team B 1, Team A 0",
      explanation: STROKE_WHY,
      consequence: "the bigger team is at a disadvantage",
    });
  });

  it("a FINISHED round is not in the preview at all: it keeps the roster it finalized with", async () => {
    const c = await cup("finished", { a: [memberId, plannerId], b: [ownerId, outsiderId] });
    const done = await insertGame(c, { game_type_id: "gtt_stroke_play", name: "Thursday Stroke", status: "complete" });
    await addParticipants(done, [memberId, plannerId, ownerId, outsiderId]);

    const p = await preview(c, memberId, c.teamB);
    expect(p.hasFinishedGames).toBe(true); // premise: the member did play in it
    expect(p.moving.map((g) => g.name)).not.toContain("Thursday Stroke");
  });
});
