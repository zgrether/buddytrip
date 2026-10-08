import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { readCreditRoster } from "./creditRoster";

/**
 * Ruling 7, the reader half: a match decided before someone left still pays the
 * team they were on (migration 207 records it on the departure; this reads it
 * back). Real database, real finalize — the fakes in `creditRoster.test.ts`
 * have no departures to read, so they cannot exercise this.
 *
 *   - CONTROL: nobody leaves, the decided match pays team A. Without this arm a
 *     "still pays A" below could be a fixture that pays A regardless.
 *   - the winner leaves before finalize: team A is still paid, and the roster
 *     recorded at the first finalize names them on A.
 *   - someone who left and CAME BACK with no team is on no team: the old record
 *     does not resurrect it.
 *
 * Each case builds its own cup (destructive writes, CLAUDE.md).
 */

const MATCH_PLAY = "gtt_match_play";
type MatchRow = { id: string };

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** Planner (A) beat member (B) on every hole of an outcome-mode match; the
 *  game is NOT finalized. Returns the ids needed to finish it. */
async function decidedMatch(label: string) {
  const tripId = await ctx.createTrip(`Departed credit ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Departed credit cup ${label}`);
  const teamA = await ctx.createTeam(competitionId, "Credit A", { shortName: "CA" });
  const teamB = await ctx.createTeam(competitionId, "Credit B", { shortName: "CB" });
  await ctx.assignTeam(competitionId, teamA, [owner, planner]);
  await ctx.assignTeam(competitionId, teamB, [member, outsider]);

  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: MATCH_PLAY, name: "Decided singles", competitionId,
    // Pays the cup per match won; without a distribution a match game writes
    // only per-person ranks and no team rows at all.
    pointsDistribution: { type: "per_match", value: 1 },
  })) as { id: string };
  const gameId = game.id;
  const [match] = (await ctx.caller().matches.setPairings({
    tripId, gameId,
    matches: [{ playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [member] }, matchNumber: 1 }],
  })) as MatchRow[];
  await ctx.caller().games.update({ tripId, gameId, entryMode: "outcome" });
  await ctx.caller().matches.enableScoring({ tripId, gameId });
  for (let hole = 1; hole <= 18; hole++) {
    await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId: match.id, holeNumber: hole, result: "side_a" });
  }
  // What the live recompute stores once a match is closed out, ahead of the
  // game's finalize — the state the archive reads to call a match decided.
  const closed = await ctx.admin.from("game_matches").update({ result: "a_win", status: "complete" }).eq("id", match.id);
  if (closed.error) throw closed.error;
  return { tripId, competitionId, gameId, teamA, teamB };
}

async function teamPoints(gameId: string): Promise<Record<string, number>> {
  const { data, error } = await ctx.admin
    .from("game_results").select("entity_id, raw_score").eq("game_id", gameId).eq("entity_type", "team");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
}

describe("a decided match pays the team the leaver was on", () => {
  it("CONTROL: nobody leaves — the decided match pays team A", async () => {
    const c = await decidedMatch("control");
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });
    const pts = await teamPoints(c.gameId);
    expect(pts[c.teamA]).toBeGreaterThan(0);
    expect(pts[c.teamA]).toBeGreaterThan(pts[c.teamB] ?? 0);
  });

  it("the winner leaves before finalize: team A is still paid, and the recorded roster names them on A", async () => {
    const c = await decidedMatch("leaver");
    const { error } = await ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: c.tripId, p_user_id: planner });
    expect(error).toBeNull();
    // Premise: they are gone from the cup's roster, so only the fallback can pay A.
    const { count } = await ctx.admin.from("team_assignments")
      .select("user_id", { count: "exact", head: true }).eq("competition_id", c.competitionId).eq("user_id", planner);
    expect(count).toBe(0);

    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });

    const pts = await teamPoints(c.gameId);
    expect(pts[c.teamA]).toBeGreaterThan(0);
    expect(pts[c.teamA]).toBeGreaterThan(pts[c.teamB] ?? 0);
    const { data: g } = await ctx.admin.from("games").select("credited_roster").eq("id", c.gameId).single();
    expect((g?.credited_roster as Record<string, string>)[planner]).toBe(c.teamA);
  });

  it("someone who left and came back with no team is on no team", async () => {
    const c = await decidedMatch("rejoined");
    expect((await ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: c.tripId, p_user_id: planner })).error).toBeNull();
    // Premise: the departure holds their old team.
    const { data: dep } = await ctx.admin.from("trip_departures").select("team_id").eq("trip_id", c.tripId).eq("user_id", planner).single();
    expect(dep?.team_id).toBe(c.teamA);

    const back = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: c.tripId, user_id: planner, role: "Member", status: "in" });
    if (back.error) throw back.error;

    const roster = await readCreditRoster(ctx.admin, c.gameId, c.competitionId);
    expect(roster.fromSnapshot).toBe(false);
    expect(roster.record[planner]).toBeUndefined();
    // Control in the same read: a current assignment is still there.
    expect(roster.record[owner]).toBe(c.teamA);
  });
});
