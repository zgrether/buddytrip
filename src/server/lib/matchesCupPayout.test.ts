import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";
import { RELOCK_BLOCKED_MATCHES } from "@/lib/gameLifecycle";

/**
 * NON-GOLF MATCHES → CUP POINTS. The board must pay the side that won.
 *
 * ── The bug this pins (#1245) ──────────────────────────────────────────────
 *
 * `writeTeamMatchPoints` scores a Matches game into `game_results` as POINTS in
 * `raw_score`, with `position` deliberately NULL. The leaderboard builds each
 * standing as `position ?? raw_score` — so for these games the points arrive
 * wearing a position's clothes, and nothing downstream can tell which of the two
 * conventions it is holding.
 *
 * A manual winner-take-all branch then claimed the game and ranked it
 * `low_wins`, which is correct for positions and exactly backwards for points:
 * the team that won 35 read as "position 35", the team that won nothing read as
 * "position 0", and the whole pot went to the side that lost every match.
 * WINNING DEMOTED YOU. Seen on a real cup, where it also handed over the
 * trophy, the celebration and the notification.
 *
 * ── Why the fixture goes through the app's own writers ─────────────────────
 *
 * The matches are built by `games.saveConfig` (the real payload builder), the
 * results are declared through `matches.setResult`, and the game is finalized
 * through `games.finish`. None of it is hand-inserted. A hand-rolled
 * `game_results` row would let this file assert against a shape the app never
 * produces — and the specific claim under test is that the WRITE is correct and
 * the READ is not, which a hand-written row would beg rather than establish.
 *
 * ── The two cases are different failures ───────────────────────────────────
 *
 * Case 1 is the inversion. Case 2 is what happens when every result is cleared:
 * both teams sit at `raw_score` 0, and under the old branch that read as two
 * teams TIED at "position 0", so `placementPoints` averaged the pot and paid
 * out 17.5 each for a game nobody won. A build that fixed only the inversion
 * would still fail case 2, which is why an outcome assertion on case 1 is not
 * enough on its own.
 */

const MANUAL = "gtt_generic_card";

let ctx: TestContext;
const gameIds: string[] = [];
const guestIds: string[] = [];

/**
 * A placeholder crew member, added to the trip.
 *
 * Needed because `saveConfig` refuses a player who appears in two matches
 * ("a player can only be in one match per game") — so three matches need six
 * distinct people and the suite ships four shared accounts. It is also the
 * FAITHFUL shape: the cup where this was found paired four placeholders and two
 * real accounts, which is what a mid-trip non-golf game normally looks like.
 * The first draft of this file reused two accounts across matches, and the
 * app's own builder rejected it — a fixture the product cannot produce.
 */
async function guest(tripId: string, name: string): Promise<string> {
  const id = `ghost-${crypto.randomUUID()}`;
  await ctx.admin.from("users").insert({ id, name, is_guest: true });
  guestIds.push(id);
  await ctx.addTripMemberById(tripId, id, "Member");
  return id;
}

interface Slice {
  matchNumber: number;
  a: string;
  b: string;
  pointValue: number | null;
}

/** The real payload builder's shape — mirrors `games.saveConfig.matches.test.ts`. */
async function saveMatches(tripId: string, gameId: string, slices: Slice[]) {
  const { data: g } = await ctx.admin.from("games").select("*").eq("id", gameId).single();
  const hash = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
  return ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: hash,
    payload: {
      name: (g!.name as string) ?? "Matches",
      rulesForToday: (g!.rules_for_today as string | null) ?? null,
      scoringEnabled: true,
      pointsTotal: (g!.points_total as number | null) ?? 35,
      pointsDistribution: g!.points_distribution ?? null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: MATCHES_COMPETITION_FORMAT,
      matches: slices.map((s) => ({
        matchNumber: s.matchNumber,
        playersPerSide: 1 as const,
        a: [s.a],
        b: [s.b],
        strokesA: 0,
        strokesB: 0,
        pointValue: s.pointValue,
      })),
      matchesStructureDirty: true,
    },
  });
}

async function matchIds(gameId: string): Promise<string[]> {
  const { data } = await ctx.admin
    .from("game_matches")
    .select("id")
    .eq("game_id", gameId)
    .order("match_number");
  return (data ?? []).map((m) => m.id as string);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  // Each case builds its own trip + cup (`createCupTrip`): a trip holds one
  // competition (migration 195).
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
  // After `cleanup` — the trip (and its `trip_members` rows) has to go first, or
  // these are still referenced.
  if (guestIds.length > 0) {
    await ctx.admin.from("users").delete().in("id", guestIds);
  }
});

describe("non-golf Matches in a match-play cup", () => {
  it("pays the side that WON the matches, not the side that lost them", async () => {
    // The shape from the cup where this was found, kept deliberately: side A is
    // the LOSING team in every match. An inverted read is invisible when the
    // winner happens to sit in slot A, so the fixture puts them in slot B.
    const { tripId, competitionId: comp } = await ctx.createCupTrip({ title: "Matches Payout Trip", name: "Matches Cup" });
    const losing = await ctx.createTeam(comp, "Manhattans", { shortName: "MAN" });
    const winning = await ctx.createTeam(comp, "Centurions", { shortName: "CEN" });

    // Six distinct people — the real cup's mix of placeholders and accounts.
    const owner = ctx.getUser("owner").id;
    const member = ctx.getUser("member").id;
    await ctx.addTripMemberById(tripId, member, "Member");
    const lostA = await guest(tripId, "Losing Ghost A");
    const lostB = await guest(tripId, "Losing Ghost B");
    const wonA = await guest(tripId, "Winning Ghost A");
    const wonB = await guest(tripId, "Winning Ghost B");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: losing },
      { competition_id: comp, user_id: lostA, team_id: losing },
      { competition_id: comp, user_id: lostB, team_id: losing },
      { competition_id: comp, user_id: member, team_id: winning },
      { competition_id: comp, user_id: wonA, team_id: winning },
      { competition_id: comp, user_id: wonB, team_id: winning },
    ]);

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "setup non golf",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    // 35 total with two per-match overrides (1 and 2) leaves 32 for the one
    // match without one — the real cup's numbers, and they matter: three equal
    // matches would let a build that mixed up which match is worth what still
    // land on the right team total.
    await ctx.admin
      .from("games")
      .update({
        points_total: 35,
        points_distribution: { type: "per_match", value: 32 },
        competition_format: MATCHES_COMPETITION_FORMAT,
      })
      .eq("id", g.id);

    await saveMatches(tripId, g.id, [
      { matchNumber: 1, a: lostA, b: wonA, pointValue: 1 },
      { matchNumber: 2, a: owner, b: member, pointValue: 2 },
      { matchNumber: 3, a: lostB, b: wonB, pointValue: null },
    ]);

    const ids = await matchIds(g.id);
    expect(ids).toHaveLength(3);
    for (const matchId of ids) {
      await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: "b_win" });
    }

    await ctx.caller().games.finish({ tripId, gameId: g.id });

    // The write itself — asserted separately from the read, because the whole
    // finding is that these two disagreed. If this half ever goes red the
    // diagnosis has changed.
    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score, position")
      .eq("game_id", g.id);
    const byTeam = new Map((rows ?? []).map((r) => [r.entity_id as string, r]));
    expect(Number(byTeam.get(winning)!.raw_score)).toBe(35);
    expect(Number(byTeam.get(losing)!.raw_score)).toBe(0);
    expect(byTeam.get(winning)!.position).toBeNull();

    // …and the read. Under the bug this was exactly reversed: 0 and 35.
    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.unitTotals[winning]).toBe(35);
    expect(lb.unitTotals[losing]).toBe(0);
  });

  /**
   * The cup for the two cases below: three matches, a 35-point pot, team B the
   * side every declared result favors. Built through the app's own writers like
   * the case above.
   */
  async function threeMatchCup(cupName: string) {
    const { tripId, competitionId: comp } = await ctx.createCupTrip({ title: "Matches Payout Trip", name: cupName });
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });
    const owner = ctx.getUser("owner").id;
    const member = ctx.getUser("member").id;
    // This cup's trip is its own, so the member joins it here.
    await ctx.addTripMemberById(tripId, member, "Member");
    const clearA = await guest(tripId, `${cupName} Ghost A1`);
    const clearB = await guest(tripId, `${cupName} Ghost B1`);
    const clearC = await guest(tripId, `${cupName} Ghost A2`);
    const clearD = await guest(tripId, `${cupName} Ghost B2`);
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: clearA, team_id: teamA },
      { competition_id: comp, user_id: clearC, team_id: teamA },
      { competition_id: comp, user_id: member, team_id: teamB },
      { competition_id: comp, user_id: clearB, team_id: teamB },
      { competition_id: comp, user_id: clearD, team_id: teamB },
    ]);

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "cleared non golf",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin
      .from("games")
      .update({
        points_total: 35,
        points_distribution: { type: "per_match", value: 32 },
        competition_format: MATCHES_COMPETITION_FORMAT,
      })
      .eq("id", g.id);

    await saveMatches(tripId, g.id, [
      { matchNumber: 1, a: clearA, b: clearB, pointValue: 1 },
      { matchNumber: 2, a: owner, b: member, pointValue: 2 },
      { matchNumber: 3, a: clearC, b: clearD, pointValue: null },
    ]);
    return { tripId, comp, teamA, teamB, gameId: g.id, ids: await matchIds(g.id) };
  }

  it("pays NOBODY when no match has a result — not half the pot each", async () => {
    // Zach's second symptom, and a DIFFERENT failure from the inversion: with
    // both teams on 0 the old branch saw a tie at "position 0" and averaged
    // [35, 0] into 17.5 apiece. A game nobody won paid out in full.
    //
    // His sequence reached it by clearing every result in a correction and
    // re-finalizing. That relock is REFUSED since #1431 (the case below), so
    // this reaches the same read through the path that remains: a first
    // finalize with every match undecided, which is permitted with a warning.
    const { tripId, comp, teamA, teamB, gameId } = await threeMatchCup("Undecided Cup");
    const res = await ctx.caller().games.finish({ tripId, gameId });
    expect(res.warning).toMatch(/^3 of 3 matches have no result yet/);

    // The mechanism, before the read: both teams' rows exist and sit on 0. With
    // no rows the board pays nobody trivially, and this case would pass without
    // ever reaching the tie the bug lived in.
    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score")
      .eq("game_id", gameId)
      .eq("entity_type", "team");
    const byTeam = new Map((rows ?? []).map((r) => [r.entity_id as string, Number(r.raw_score)]));
    expect(byTeam.get(teamA)).toBe(0);
    expect(byTeam.get(teamB)).toBe(0);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.unitTotals[teamA]).toBe(0);
    expect(lb.unitTotals[teamB]).toBe(0);
  });

  it("clearing every result in a correction can't be saved — the board keeps the last saved result (#1431)", async () => {
    // Zach's own sequence from the report above, which this case used to carry
    // through to a re-finalize. Since #1431 the relock refuses an undecided
    // match, so the cleared correction is never recorded and the board still
    // pays what was last saved.
    const { tripId, comp, teamA, teamB, gameId, ids } = await threeMatchCup("Cleared Cup");
    for (const matchId of ids) {
      await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: "b_win" });
    }
    await ctx.caller().games.finish({ tripId, gameId });
    const decided = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(decided.unitTotals[teamB]).toBe(35);

    await ctx.caller().games.openCorrection({ tripId, gameId });
    for (const matchId of ids) {
      await ctx.caller().matches.setResult({ tripId, gameId, matchId, result: null });
    }
    await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toThrow(RELOCK_BLOCKED_MATCHES);

    const after = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(after.unitTotals[teamA]).toBe(0);
    expect(after.unitTotals[teamB]).toBe(35);
  });
});

/**
 * The convention, carried to the ranking (#1381, after #1245).
 *
 * This used to be an INVARIANT that threw when points rows reached a `low_wins`
 * arm. #1381 promoted it: the rows' convention now travels with the standings
 * and `reconcileConvention` ranks by it, so the same state is now PAID CORRECTLY
 * — and still reported, with the evidence, because a game configured against
 * its own results is worth knowing about. The two cases above exercise the
 * silent direction (rows and arm agree); these exercise the reconciliation.
 */
describe("ranking-convention reconciliation", () => {
  it("pays the points as scored — and reports it with the game id and the actual scores, not just a verdict", async () => {
    // A SYNTHETIC state: nothing the app writes produces it, so the test has to
    // manufacture one. A manual game with no match rows takes the winner-take-all
    // `low_wins` path, and these rows carry POINTS with no position — the exact
    // pairing #1245 was. Before #1381 this threw; before #1245 it paid the side
    // that scored 0.
    const { tripId, competitionId: comp } = await ctx.createCupTrip({ title: "Matches Payout Trip", name: "Invariant Cup" });
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "corrupt shape",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    // FINISHED: these rows are a finalize's output, and since #1416 the board
    // banks a game only once it is. (The fixture used to leave it live.)
    await ctx.admin.from("games").update({ points_total: 35, status: "complete" }).eq("id", g.id);
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamA, entity_type: "team", value_kind: "points", position: null, raw_score: 0 },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamB, entity_type: "team", value_kind: "points", position: null, raw_score: 35 },
    ]);

    const warns: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(String(a[0])); };
    let lb: Awaited<ReturnType<ReturnType<typeof ctx.caller>["competitions"]["leaderboard"]>>;
    try {
      lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    } finally {
      console.warn = realWarn;
    }

    // The payout: the side that scored 35 gets 35, the side that scored 0 gets 0.
    expect(lb.unitTotals[teamB]).toBe(35);
    expect(lb.unitTotals[teamA]).toBe(0);

    // The EVIDENCE, not the conclusion. Exactly one line, naming this game, the
    // arm's direction, and the values it ranked — every instrument failure this
    // project has recorded was a report that asserted a conclusion with none of
    // this behind it.
    const line = warns.filter((w) => w.includes("ranking-convention reconciled"));
    expect(line).toHaveLength(1);
    expect(line[0]).toContain(g.id);
    expect(line[0]).toContain('"armDirection":"low_wins"');
    expect(line[0]).toContain('"value":35');
    expect(line[0]).toContain(`"entityId":"${teamB}"`);
  });

  it("stays silent on a placement game, which legitimately ranks low_wins", async () => {
    // The false-positive direction. Positions are what `low_wins` is FOR, so a
    // guard that fired here would be unshippable — it would throw on the most
    // common shape on the board.
    const { tripId, competitionId: comp } = await ctx.createCupTrip({ title: "Matches Payout Trip", name: "Placement Quiet Cup" });
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "ordinary manual",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    // FINISHED: these rows are a finalize's output, and since #1416 the board
    // banks a game only once it is. (The fixture used to leave it live.)
    await ctx.admin.from("games").update({ points_total: 8, status: "complete" }).eq("id", g.id);
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamA, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamB, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
    ]);

    const warns: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(String(a[0])); };
    let lb: Awaited<ReturnType<ReturnType<typeof ctx.caller>["competitions"]["leaderboard"]>>;
    try {
      lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    } finally {
      console.warn = realWarn;
    }
    expect(lb.unitTotals[teamA]).toBe(8);
    expect(lb.unitTotals[teamB]).toBe(0);
    expect(warns.filter((w) => w.includes("ranking-convention"))).toEqual([]);
  });
});
