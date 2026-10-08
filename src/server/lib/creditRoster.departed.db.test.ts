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
 *   - they win, leave and REJOIN teamless (8b will not reassign them while the
 *     game is unfinished): the win still pays A — the departure applies to any
 *     game that existed when they left, rejoined or not;
 *   - a game created AFTER they left does not take the departure's team;
 *   - a fresh assignment always beats the departure's team.
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

  it("wins, leaves, REJOINS with no team: the win still pays A at finalize", async () => {
    // The case two features meet in. 8b will not put them back on a team while
    // they sit in an unfinished team-dependent game, and the decided match
    // keeps their seat — so they are back on the trip and teamless until the
    // game finalizes. Ignoring the departure for a rejoined member would make
    // the win pay nobody (ruling 7).
    const c = await decidedMatch("rejoined");
    expect((await ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: c.tripId, p_user_id: planner })).error).toBeNull();
    const back = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: c.tripId, user_id: planner, role: "Member", status: "in" });
    if (back.error) throw back.error;
    // Premise: on the trip again, and on no team.
    const { count } = await ctx.admin.from("team_assignments")
      .select("user_id", { count: "exact", head: true }).eq("competition_id", c.competitionId).eq("user_id", planner);
    expect(count).toBe(0);

    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });

    const pts = await teamPoints(c.gameId);
    expect(pts[c.teamA]).toBeGreaterThan(pts[c.teamB] ?? 0);
    const { data: g } = await ctx.admin.from("games").select("credited_roster").eq("id", c.gameId).single();
    expect((g?.credited_roster as Record<string, string>)[planner]).toBe(c.teamA);
  });

  it("a game created AFTER they left does not take the departure's team", async () => {
    const c = await decidedMatch("later game");
    expect((await ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: c.tripId, p_user_id: planner })).error).toBeNull();
    const later = (await ctx.caller().games.create({
      tripId: c.tripId, gameTypeId: MATCH_PLAY, name: "Created later", competitionId: c.competitionId,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };

    expect((await readCreditRoster(ctx.admin, later.id, c.competitionId)).record[planner]).toBeUndefined();
    // Control in the same breath: the game that existed when they left does.
    expect((await readCreditRoster(ctx.admin, c.gameId, c.competitionId)).record[planner]).toBe(c.teamA);
  });

  it("a FRESH assignment always beats the departure's team", async () => {
    const c = await decidedMatch("fresh team");
    expect((await ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: c.tripId, p_user_id: planner })).error).toBeNull();
    const back = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: c.tripId, user_id: planner, role: "Member", status: "in" });
    if (back.error) throw back.error;
    // Written directly: 8b refuses this through the app while the game is
    // unfinished, which is exactly why the departure team is safe to use. This
    // pins the precedence for the day that is no longer true.
    await ctx.assignTeam(c.competitionId, c.teamB, [planner]);

    const roster = await readCreditRoster(ctx.admin, c.gameId, c.competitionId);
    expect(roster.fromSnapshot).toBe(false);
    expect(roster.record[planner]).toBe(c.teamB);
  });
});
