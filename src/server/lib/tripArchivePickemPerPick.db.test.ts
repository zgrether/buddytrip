import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 208. Two rules, both from Zach's rulings of 2026-10-08:
 *
 *   - PER PICK: in an unfinished pick'em, a leaver's pick whose slate game has
 *     a result is history and stays (credited through the departure's team); a
 *     pick on a game not yet played is cleared. A sheet with nothing resolved
 *     ends up empty — ruling 6 and ruling 7 as one rule at a finer grain.
 *   - A SECOND DEPARTURE KEEPS THE TEAM: someone who wins, leaves, rejoins
 *     teamless (8b will not reassign them while the game is unfinished) and
 *     leaves again keeps the team the first departure recorded. A real team
 *     on the second departure still replaces it.
 *
 * Each case builds its own cup (destructive writes, CLAUDE.md).
 */

const MATCH_PLAY = "gtt_match_play";

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

/** Pick'em pays teams, so it needs a teamed cup. member + outsider on B. */
async function cup(label: string) {
  const tripId = await ctx.createTrip(`Per pick ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Per pick cup ${label}`);
  const teamA = await ctx.createTeam(competitionId, "Pick A", { shortName: "PA" });
  const teamB = await ctx.createTeam(competitionId, "Pick B", { shortName: "PB" });
  await ctx.assignTeam(competitionId, teamA, [owner, planner]);
  await ctx.assignTeam(competitionId, teamB, [member, outsider]);
  return { tripId, competitionId, teamA, teamB };
}

/** An unfinished pick'em with two slate games: one with a result, one not. */
async function pickem(c: { tripId: string; competitionId: string }, name: string, resolvedResult: string | null) {
  const g = (await ctx.caller().games.create({ tripId: c.tripId, gameTypeId: "gtt_pickem", name, competitionId: c.competitionId })) as { id: string };
  const pg = await ctx.admin.from("pickem_games").upsert({ game_id: g.id });
  if (pg.error) throw pg.error;
  const played = genId("slate");
  const unplayed = genId("slate");
  const sg = await ctx.admin.from("pickem_slate_games").insert([
    { id: played, game_id: g.id, display_order: 0, away_team: "Alabama", home_team: "Georgia", multiplier: 1, result: resolvedResult },
    { id: unplayed, game_id: g.id, display_order: 1, away_team: "Auburn", home_team: "Florida", multiplier: 1, result: null },
  ]);
  if (sg.error) throw sg.error;
  return { gameId: g.id, played, unplayed };
}

async function pick(gameId: string, slateId: string, userId: string, enteredBy: string | null = null) {
  const { error } = await ctx.admin.from("pickem_picks").insert({
    id: genId("pick"), game_id: gameId, slate_game_id: slateId, user_id: userId, pick: "home", entered_by: enteredBy,
  });
  if (error) throw error;
}

async function picksOn(slateId: string, userId: string) {
  const { count, error } = await ctx.admin.from("pickem_picks")
    .select("id", { count: "exact", head: true }).eq("slate_game_id", slateId).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

async function departureTeam(tripId: string, userId: string) {
  const { data, error } = await ctx.admin.from("trip_departures").select("team_id").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data === null ? undefined : (data.team_id as string | null);
}

const removeAsOwner = (tripId: string, userId: string) =>
  ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: tripId, p_user_id: userId });

async function rejoin(tripId: string, userId: string) {
  const { error } = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: tripId, user_id: userId, role: "Member", status: "in" });
  if (error) throw error;
}

describe("a pick is history once its game has a result (per pick)", () => {
  it("resolved picks stay, unplayed ones go, a sheet they entered for someone else stays, and the departure carries their team", async () => {
    const c = await cup("per pick");
    const p = await pickem(c, "This week", "home");
    await pick(p.gameId, p.played, member);
    await pick(p.gameId, p.unplayed, member);
    // A pick the member ENTERED for the outsider, on the unplayed game: the
    // outsider's sheet, untouched by the member leaving.
    await pick(p.gameId, p.unplayed, outsider, member);

    expect((await removeAsOwner(c.tripId, member)).error).toBeNull();

    expect(await picksOn(p.played, member)).toBe(1);
    expect(await picksOn(p.unplayed, member)).toBe(0);
    expect(await picksOn(p.unplayed, outsider)).toBe(1);
    // The team the kept pick pays through: 8a's roster reader falls back to
    // it (PR 8d-2, `creditRoster.departed.db.test.ts`).
    expect(await departureTeam(c.tripId, member)).toBe(c.teamB);
  });

  it("a cancelled game's pick was decided too: it stays", async () => {
    const c = await cup("cancelled");
    const p = await pickem(c, "Rained out", "cancelled");
    await pick(p.gameId, p.played, member);
    expect((await removeAsOwner(c.tripId, member)).error).toBeNull();
    expect(await picksOn(p.played, member)).toBe(1);
  });

  it("CONTROL: a sheet with nothing resolved ends up empty — ruling 6's behaviour", async () => {
    const c = await cup("nothing resolved");
    const p = await pickem(c, "Next week", null);
    await pick(p.gameId, p.played, member);
    await pick(p.gameId, p.unplayed, member);
    expect((await removeAsOwner(c.tripId, member)).error).toBeNull();
    expect(await picksOn(p.played, member)).toBe(0);
    expect(await picksOn(p.unplayed, member)).toBe(0);
  });
});

describe("a second departure keeps the team the first one recorded", () => {
  /** A decided match the planner (A) won, in an unfinished game. */
  async function decided(c: { tripId: string; competitionId: string }) {
    const game = (await ctx.caller().games.create({
      tripId: c.tripId, gameTypeId: MATCH_PLAY, name: "Won before leaving", competitionId: c.competitionId,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    const [m] = (await ctx.caller().matches.setPairings({
      tripId: c.tripId, gameId: game.id,
      matches: [{ playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [member] }, matchNumber: 1 }],
    })) as { id: string }[];
    const closed = await ctx.admin.from("game_matches").update({ result: "a_win", status: "complete" }).eq("id", m.id);
    if (closed.error) throw closed.error;
  }

  it("wins, leaves, rejoins teamless, leaves again: the departure still says A", async () => {
    const c = await cup("re-leave teamless");
    await decided(c);
    expect((await removeAsOwner(c.tripId, planner)).error).toBeNull();
    expect(await departureTeam(c.tripId, planner)).toBe(c.teamA);

    await rejoin(c.tripId, planner);
    expect((await removeAsOwner(c.tripId, planner)).error).toBeNull();
    expect(await departureTeam(c.tripId, planner)).toBe(c.teamA);
  });

  it("CONTROL: a real team on the second departure replaces the first", async () => {
    const c = await cup("re-leave on B");
    await decided(c);
    expect((await removeAsOwner(c.tripId, planner)).error).toBeNull();
    await rejoin(c.tripId, planner);
    // Written directly — the state a reassignment produces once nothing blocks it.
    await ctx.assignTeam(c.competitionId, c.teamB, [planner]);
    expect((await removeAsOwner(c.tripId, planner)).error).toBeNull();
    expect(await departureTeam(c.tripId, planner)).toBe(c.teamB);
  });
});
