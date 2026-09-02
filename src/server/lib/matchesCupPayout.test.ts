import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

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
let tripId: string;
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
async function guest(name: string): Promise<string> {
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
async function saveMatches(gameId: string, slices: Slice[]) {
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
  tripId = await ctx.createTrip("Matches Payout Trip");
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
    const comp = await ctx.createCompetition(tripId, "Matches Cup");
    const losing = await ctx.createTeam(comp, "Manhattans", { shortName: "MAN" });
    const winning = await ctx.createTeam(comp, "Centurions", { shortName: "CEN" });

    // Six distinct people — the real cup's mix of placeholders and accounts.
    const owner = ctx.getUser("owner").id;
    const member = ctx.getUser("member").id;
    await ctx.addTripMemberById(tripId, member, "Member");
    const lostA = await guest("Losing Ghost A");
    const lostB = await guest("Losing Ghost B");
    const wonA = await guest("Winning Ghost A");
    const wonB = await guest("Winning Ghost B");
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

    await saveMatches(g.id, [
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
    expect(lb.teamTotals[winning]).toBe(35);
    expect(lb.teamTotals[losing]).toBe(0);
  });

  it("pays NOBODY when every result is cleared — not half the pot each", async () => {
    // Zach's second symptom, and a DIFFERENT failure from the inversion: with
    // both teams on 0 the old branch saw a tie at "position 0" and averaged
    // [35, 0] into 17.5 apiece. A game nobody won paid out in full.
    //
    // The sequence is his: finalize with results, then clear them and
    // re-finalize, rather than starting from a game that never had any. Those
    // are different states — the first has `game_results` rows already written
    // — and only the first is what was reported.
    const comp = await ctx.createCompetition(tripId, "Cleared Cup");
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });
    const owner = ctx.getUser("owner").id;
    const member = ctx.getUser("member").id;
    const clearA = await guest("Cleared Ghost A1");
    const clearB = await guest("Cleared Ghost B1");
    const clearC = await guest("Cleared Ghost A2");
    const clearD = await guest("Cleared Ghost B2");
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

    await saveMatches(g.id, [
      { matchNumber: 1, a: clearA, b: clearB, pointValue: 1 },
      { matchNumber: 2, a: owner, b: member, pointValue: 2 },
      { matchNumber: 3, a: clearC, b: clearD, pointValue: null },
    ]);

    const ids = await matchIds(g.id);
    for (const matchId of ids) {
      await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: "b_win" });
    }
    await ctx.caller().games.finish({ tripId, gameId: g.id });

    const decided = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(decided.teamTotals[teamB]).toBe(35);

    // Now clear all three, the way the reporter did — corrections open, every
    // result unset, finalize again.
    await ctx.caller().games.openCorrection({ tripId, gameId: g.id });
    for (const matchId of ids) {
      await ctx.caller().matches.setResult({ tripId, gameId: g.id, matchId, result: null });
    }
    await ctx.caller().games.finish({ tripId, gameId: g.id });

    const cleared = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(cleared.teamTotals[teamA]).toBe(0);
    expect(cleared.teamTotals[teamB]).toBe(0);
  });
});

/**
 * The convention invariant itself.
 *
 * The two cases above already exercise it in the SILENT direction — both run a
 * game whose results carry null positions, and if the guard misfired on a
 * `high_wins` path they would throw rather than assert a number. What is left is
 * the direction that matters: that it actually fires, and that it says enough to
 * act on.
 */
describe("ranking-convention invariant", () => {
  it("fires — with the game id and the actual scores, not just a verdict", async () => {
    // A SYNTHETIC state. The fix means nothing produces this any more, which is
    // the point of an invariant: it guards a state that should not occur, so the
    // test has to manufacture one. A manual game with no match rows takes the
    // winner-take-all `low_wins` path, and these rows carry POINTS with no
    // position — the exact pairing #1245 was.
    const comp = await ctx.createCompetition(tripId, "Invariant Cup");
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "corrupt shape",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin.from("games").update({ points_total: 35 }).eq("id", g.id);
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamA, entity_type: "team", position: null, raw_score: 0 },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamB, entity_type: "team", position: null, raw_score: 35 },
    ]);

    const read = ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    await expect(read).rejects.toThrow(/ranking-convention mismatch/);

    // The EVIDENCE, not the conclusion. A message naming only the rule tells you
    // one fired; these tell you which game and what it was about to do — and
    // every instrument failure this project has recorded was a report that
    // asserted a conclusion with none of this behind it.
    await expect(read).rejects.toThrow(new RegExp(g.id));
    await expect(read).rejects.toThrow(/low_wins/);
    await expect(read).rejects.toThrow(/"value":35/);
    await expect(read).rejects.toThrow(new RegExp(`"entityId":"${teamB}"`));
  });

  it("stays silent on a placement game, which legitimately ranks low_wins", async () => {
    // The false-positive direction. Positions are what `low_wins` is FOR, so a
    // guard that fired here would be unshippable — it would throw on the most
    // common shape on the board.
    const comp = await ctx.createCompetition(tripId, "Placement Quiet Cup");
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });

    const g = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MANUAL,
      name: "ordinary manual",
      competitionId: comp,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin.from("games").update({ points_total: 8 }).eq("id", g.id);
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamA, entity_type: "team", position: 1, raw_score: 1 },
      { id: crypto.randomUUID(), game_id: g.id, entity_id: teamB, entity_type: "team", position: 2, raw_score: 2 },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[teamA]).toBe(8);
    expect(lb.teamTotals[teamB]).toBe(0);
  });
});
