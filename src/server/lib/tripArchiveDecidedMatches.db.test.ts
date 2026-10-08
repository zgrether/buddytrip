import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 207: a decided match is history (Zach, 2026-10-08). In an
 * UNFINISHED game, a match already won or halved keeps both seats and the
 * leaver keeps their participant row there; an undecided match still empties.
 * The departure records the leaver's cup team, which 8a's roster reader falls
 * back to (`creditRoster.departed.test.ts` pins that half).
 *
 * A match is decided here the way the app decides one mid-game: the recompute
 * writes `status='complete'` and a result when a match closes out, while the
 * game itself stays unfinished. Each case builds its own cup (destructive
 * writes, CLAUDE.md).
 */

const MATCH_PLAY = "gtt_match_play";
type Side = { type: string; id: string } | null;
type MatchRow = { id: string; side_a: Side; side_b: Side };

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

async function cup(label: string) {
  const tripId = await ctx.createTrip(`Decided ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Decided Cup ${label}`);
  const teamA = await ctx.createTeam(competitionId, "Decided A", { shortName: "DA" });
  const teamB = await ctx.createTeam(competitionId, "Decided B", { shortName: "DB" });
  await ctx.assignTeam(competitionId, teamA, [owner, planner]);
  await ctx.assignTeam(competitionId, teamB, [member, outsider]);
  return { tripId, competitionId, teamA, teamB };
}

async function matchGame(
  c: { tripId: string; competitionId: string },
  name: string,
  matches: { playersPerSide: 1 | 2; sideA: { members: string[] }; sideB: { members: string[] }; matchNumber: number }[]
): Promise<{ gameId: string; rows: MatchRow[] }> {
  const game = (await ctx.caller().games.create({
    tripId: c.tripId, gameTypeId: MATCH_PLAY, name, competitionId: c.competitionId, pointsTotal: 10,
  })) as { id: string };
  const rows = (await ctx.caller().matches.setPairings({ tripId: c.tripId, gameId: game.id, matches })) as MatchRow[];
  return { gameId: game.id, rows };
}

/** What the recompute writes when a match closes out before the game finalizes. */
async function decide(matchId: string, result: "a_win" | "b_win" | "halve") {
  const { error } = await ctx.admin.from("game_matches").update({ result, status: "complete" }).eq("id", matchId);
  if (error) throw error;
}

async function seat(matchId: string): Promise<MatchRow> {
  const { data, error } = await ctx.admin.from("game_matches").select("id, side_a, side_b").eq("id", matchId).single();
  if (error) throw error;
  return data as MatchRow;
}

async function participates(gameId: string, userId: string): Promise<boolean> {
  const { count, error } = await ctx.admin.from("game_participants")
    .select("user_id", { count: "exact", head: true }).eq("game_id", gameId).eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function departureTeam(tripId: string, userId: string): Promise<string | null | undefined> {
  const { data, error } = await ctx.admin.from("trip_departures")
    .select("team_id").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data === null ? undefined : (data.team_id as string | null);
}

/** The Owner removes them — the archive's removal path. */
const archive = (tripId: string, userId: string) =>
  ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: tripId, p_user_id: userId });

describe("a decided match is history", () => {
  it("1v1: the decided match keeps both seats and the leaver's participation; the undecided one empties; the departure carries their team", async () => {
    const c = await cup("singles");
    // One game, two matches: the planner's is decided, the other is not.
    const g = await matchGame(c, "Singles", [
      { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [member] }, matchNumber: 1 },
      { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [outsider] }, matchNumber: 2 },
    ]);
    // A second unfinished game where the planner's match is still being played.
    const live = await matchGame(c, "Still playing", [
      { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 1 },
    ]);
    await decide(g.rows[0].id, "a_win");

    expect((await archive(c.tripId, planner)).error).toBeNull();

    const decided = await seat(g.rows[0].id);
    expect(decided.side_a).toEqual({ type: "user", id: planner });
    expect(decided.side_b).toEqual({ type: "user", id: member });
    expect(await participates(g.gameId, planner)).toBe(true);

    const undecided = await seat(live.rows[0].id);
    expect(undecided.side_a).toBeNull();
    expect((undecided.side_b as { id: string }).id).toBe(outsider);
    expect(await participates(live.gameId, planner)).toBe(false);

    expect(await departureTeam(c.tripId, planner)).toBe(c.teamA);
  });

  it("2v2: a decided doubles match keeps the leaver's participant row (it resolves the side); an undecided one drops it and the partner plays on", async () => {
    const c = await cup("doubles");
    const decided = await matchGame(c, "Doubles decided", [
      { playersPerSide: 2, sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 },
    ]);
    const open = await matchGame(c, "Doubles open", [
      { playersPerSide: 2, sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 },
    ]);
    await decide(decided.rows[0].id, "halve");
    const openSideBefore = (await seat(open.rows[0].id)).side_a;

    expect((await archive(c.tripId, planner)).error).toBeNull();

    expect(await participates(decided.gameId, planner)).toBe(true);
    expect(await participates(open.gameId, planner)).toBe(false);
    // The open side is the shared play_group; it survives with the partner.
    expect((await seat(open.rows[0].id)).side_a).toEqual(openSideBefore);
    expect(await participates(open.gameId, owner)).toBe(true);
  });

  it("someone on no team leaves with a decided match: the record says so (null), not a guessed team", async () => {
    const c = await cup("no team");
    const g = await matchGame(c, "Teamless leaver", [
      { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [member] }, matchNumber: 1 },
    ]);
    await decide(g.rows[0].id, "b_win");
    const off = await ctx.admin.from("team_assignments").delete().eq("competition_id", c.competitionId).eq("user_id", planner);
    if (off.error) throw off.error;

    expect((await archive(c.tripId, planner)).error).toBeNull();
    // A record exists (the decided match is history) and its team is NULL.
    expect(await departureTeam(c.tripId, planner)).toBeNull();
  });
});

describe("a line the app wrote ABOUT someone is not their history", () => {
  async function userExists(id: string) {
    const { count } = await ctx.admin.from("users").select("id", { count: "exact", head: true }).eq("id", id);
    return (count ?? 0) > 0;
  }

  it("a placeholder whose only footprint is its join line leaves no record and is deleted; one who wrote a message is kept", async () => {
    const tripId = await ctx.createTrip("Join line not history");
    // Through the app: `ghostCrew.create` posts the "joined" system line, with
    // the placeholder as its subject (`messages.user_id`).
    const quiet = (await ctx.caller().ghostCrew.create({ tripId, name: "Added By Mistake" })) as { id: string };
    const chatty = (await ctx.caller().ghostCrew.create({ tripId, name: "Said Something" })) as { id: string };
    const { count: lines } = await ctx.admin.from("messages")
      .select("id", { count: "exact", head: true }).eq("trip_id", tripId).eq("user_id", quiet.id).eq("message_type", "system");
    expect(lines).toBeGreaterThan(0); // premise: the join line names them
    const said = await ctx.admin.from("messages").insert({
      id: crypto.randomUUID(), trip_id: tripId, user_id: chatty.id, channel: "trip", team_id: null, text: "hi",
    });
    if (said.error) throw said.error;

    for (const id of [quiet.id, chatty.id]) {
      expect((await archive(tripId, id)).error).toBeNull();
      expect((await ctx.authedClient("owner").rpc("delete_orphan_guest_user", { p_user_id: id })).error).toBeNull();
    }

    expect(await departureTeam(tripId, quiet.id)).toBeUndefined();
    expect(await userExists(quiet.id)).toBe(false);
    expect(await departureTeam(tripId, chatty.id)).toBeNull(); // a record, on no team
    expect(await userExists(chatty.id)).toBe(true);
  });
});
