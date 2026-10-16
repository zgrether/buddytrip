import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { callerFailingRead, clientFailingRead } from "../../__tests__/helpers/failingRead";
import { notifyCupClinchedIfDecided } from "./gameFinishNotify";
import { sendPushToUsers, type SendPushToUsersResult } from "./sendPushToUsers";
import { seedScrambleTeamGroups } from "./scrambleTeamGroups";
import { notifyPickemMatchesNotDrawn } from "./pickemMatchesNotify";

vi.mock("./sendPushToUsers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sendPushToUsers")>();
  return { ...actual, sendPushToUsers: vi.fn(actual.sendPushToUsers) };
});

/**
 * #1471 — reads that decide a push or a write fail closed, against a real
 * database. Each failing case uses a client that fails exactly ONE read (table
 * + column string), next to a control on the real client.
 *
 *  - The CLINCH reads its audience BEFORE taking the claim, and gives the claim
 *    back when the send reached nobody because it failed. Either way a later
 *    finalize can still announce it; before, a failed read left the claim held
 *    and every later finalize recorded `already_claimed`.
 *  - The SCRAMBLE seed's "any groups yet?" count no longer reads a failure as
 *    zero, which seeded a second set of groups.
 *  - `matches.addMatch` and `matches.setPairings` refuse on a failed read
 *    instead of skipping the limit, the finished-game freeze, or the
 *    split-sides check.
 *  - Pick'em's "draw the matches" push no longer fires on a failed matches read.
 */

const READ_FAILED = "This is temporary — try again in a moment.";
let ctx: TestContext;
const sendMock = vi.mocked(sendPushToUsers);

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

// ── The clinch ────────────────────────────────────────────────────────────────

/** A decided cup: winner takes 2 of 3 one-point games. */
async function decidedCup(label: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({ name: `1471 ${label}`, scoringModel: "match_play" });
  const winner = await ctx.createTeam(competitionId, "Winner", { shortName: "WIN" });
  const loser = await ctx.createTeam(competitionId, "Loser", { shortName: "LOS" });
  await ctx.admin.from("team_assignments").insert([{ competition_id: competitionId, user_id: ctx.user.id, team_id: winner }]);
  for (const [name, first, second] of [["G1", winner, loser], ["G2", winner, loser], ["G3", loser, winner]] as const) {
    const id = crypto.randomUUID();
    const g = await ctx.admin.from("games").insert({
      id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_stroke_play", name,
      status: "complete", scoring_enabled: true, points_total: 1,
      points_distribution: { type: "placement", values: [1] },
    });
    if (g.error) throw new Error(g.error.message);
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
      { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
    ]);
  }
  return { tripId, competitionId, winner };
}

async function claimOf(competitionId: string) {
  const { data } = await ctx.admin.from("competitions").select("clinch_notified_team_id").eq("id", competitionId).single();
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

const notify = (tripId: string, competitionId: string, admin = ctx.admin) =>
  notifyCupClinchedIfDecided({ tripId, competitionId, actorUserId: "nobody", admin });

const result = (over: Partial<SendPushToUsersResult>): SendPushToUsersResult => ({
  sent: 0, skippedPreferenceOff: 0, recipients: 1, removedDead: 0, notConfigured: false,
  subscriptionsFound: 0, failed: 0, error: null, ...over,
});

describe("the clinch is never left claimed and unannounced (#1471)", () => {
  it("a failed AUDIENCE read takes no claim, so the next finalize announces it", async () => {
    const cup = await decidedCup("audience");
    const failing = clientFailingRead(ctx.admin, { table: "team_assignments", columns: "user_id" });
    await notify(cup.tripId, cup.competitionId, failing);
    expect(await claimOf(cup.competitionId), "no claim after a failed read").toBeNull();

    await notify(cup.tripId, cup.competitionId);
    expect(await claimOf(cup.competitionId), "the next finalize claims it").toBe(cup.winner);
  }, 60_000);

  it("a send that reached NOBODY because it failed gives the claim back", async () => {
    const cup = await decidedCup("send failed");
    sendMock.mockResolvedValueOnce(result({ error: "could not read notification preferences: simulated" }));
    await notify(cup.tripId, cup.competitionId);
    expect(await claimOf(cup.competitionId)).toBeNull();
  }, 60_000);

  it("CONTROL: a send that found nobody with a device (no error) keeps the claim", async () => {
    const cup = await decidedCup("no devices");
    sendMock.mockResolvedValueOnce(result({ subscriptionsFound: 0 }));
    await notify(cup.tripId, cup.competitionId);
    expect(await claimOf(cup.competitionId)).toBe(cup.winner);
  }, 60_000);

  it("CONTROL: a send that reached someone keeps the claim even if another delivery failed", async () => {
    const cup = await decidedCup("partial");
    sendMock.mockResolvedValueOnce(result({ sent: 1, failed: 1, error: "delivery failed (status 500)" }));
    await notify(cup.tripId, cup.competitionId);
    expect(await claimOf(cup.competitionId)).toBe(cup.winner);
  }, 60_000);
});

// ── The scramble seed ─────────────────────────────────────────────────────────

describe("the scramble seed never seeds twice (#1471)", () => {
  it("a failed 'any groups yet?' count does not add a second set; the real seed adds one", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: "1471 scramble", scoringModel: "points", members: [["member", "Member"]], teams: ["Red", "Blue"],
    });
    const [red, blue] = (await ctx.admin.from("teams").select("id").eq("competition_id", competitionId).order("created_at")).data!.map((t) => t.id as string);
    await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: ctx.user.id, team_id: red },
      { competition_id: competitionId, user_id: ctx.getUser("member").id, team_id: blue },
    ]);
    const gameId = genId("game");
    await ctx.admin.from("games").insert({ id: gameId, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_scramble", name: "Scramble", status: "pending" });
    const groups = async () => (await ctx.admin.from("play_groups").select("id", { count: "exact", head: true }).eq("game_id", gameId)).count;

    // CONTROL: the real seed writes one group per team.
    await seedScrambleTeamGroups(ctx.admin, gameId, "gtt_scramble", competitionId);
    expect(await groups()).toBe(2);

    await seedScrambleTeamGroups(clientFailingRead(ctx.admin, { table: "play_groups", columns: "id" }), gameId, "gtt_scramble", competitionId);
    expect(await groups(), "a failed count must not read as zero").toBe(2);
  }, 60_000);
});

// ── The match procedures ──────────────────────────────────────────────────────

describe("match writes refuse on a failed read (#1471)", () => {
  it("matches.addMatch: a failed list read refuses instead of counting zero matches", async () => {
    const tripId = await ctx.createTrip("1471 addMatch");
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "M" })) as { id: string };
    const failing = callerFailingRead(ctx, "owner", { table: "game_matches", columns: "match_number, display_order" });
    await expect(failing.matches.addMatch({ tripId, gameId: game.id })).rejects.toThrow(READ_FAILED);
    const { count } = await ctx.admin.from("game_matches").select("id", { count: "exact", head: true }).eq("game_id", game.id);
    expect(count).toBe(0);
    // CONTROL: the real caller adds it.
    await ctx.caller().matches.addMatch({ tripId, gameId: game.id });
    expect((await ctx.admin.from("game_matches").select("id", { count: "exact", head: true }).eq("game_id", game.id)).count).toBe(1);
  }, 60_000);

  it("matches.setPairings: a failed game read refuses instead of skipping the split-sides check", async () => {
    const tripId = await ctx.createTrip("1471 setPairings");
    await ctx.addTripMember(tripId, "member", "Member");
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "M" })) as { id: string };
    const matches = [{ playersPerSide: 1 as const, sideA: { members: [ctx.user.id] }, sideB: { members: [ctx.getUser("member").id] }, matchNumber: 1 }];
    const failing = callerFailingRead(ctx, "owner", { table: "games", columns: "competition_id" });
    await expect(failing.matches.setPairings({ tripId, gameId: game.id, matches })).rejects.toThrow(READ_FAILED);
    // CONTROL: the real caller pairs it.
    await expect(ctx.caller().matches.setPairings({ tripId, gameId: game.id, matches })).resolves.toBeTruthy();
  }, 60_000);
});

// ── Pick'em: "draw the matches" ───────────────────────────────────────────────

describe("pick'em's 'draw the matches' push needs a real read (#1471)", () => {
  it("a failed matches read sends nothing; the real read sends", async () => {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: "1471 pickem", scoringModel: "match_play", teams: ["A", "B"] });
    const game = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_pickem", name: "Picks", competitionId })) as { id: string };
    await ctx.admin.from("pickem_games").upsert({ game_id: game.id, roll_up: "individual_matches" });
    const input = { tripId, gameId: game.id, actorUserId: "nobody", priorResults: 0, newResult: "away" };

    sendMock.mockClear();
    const failed = await notifyPickemMatchesNotDrawn(input, { admin: clientFailingRead(ctx.admin, { table: "game_matches", columns: "side_a, side_b" }) });
    expect(failed).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();

    // CONTROL: with the read working, the same state does send.
    const sent = await notifyPickemMatchesNotDrawn(input, { admin: ctx.admin });
    expect(sent).not.toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
  }, 60_000);
});
