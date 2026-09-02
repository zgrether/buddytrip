import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * GLORIOUS FINISHING HOLES MAY NOT REVALUE A HOLE ALREADY PLAYED (migration 178).
 *
 * The rule, in one sentence: a GFH change is permitted only if it would not alter
 * the weight of any hole that has already been scored — on, off, raising N,
 * lowering N.
 *
 * ── The two builds these tests exist to fail ───────────────────────────────
 *
 * Both of the obvious wrong builds pass a subset of this file, which is why the
 * cases are shaped the way they are rather than as one "it refuses" test:
 *
 *   · CAP-ONLY. Implement `N <= 18 - played` and nothing else, and the frozen
 *     case reads as permitted — lowering N from 3 to 2 is "within the limit",
 *     while it de-weights hole 17 somebody already played doubled. Caught by
 *     "every change is refused", not by any cap assertion.
 *   · GUARD WITHOUT THE FLAG. Refuse correctly, but leave `skipComplete: true`
 *     on saveConfig's recompute, and a PERMITTED change still leaves the match
 *     frozen at its pre-GFH result. That is the original reported bug surviving
 *     behind a new guard, and only the reopen case sees it.
 *
 * ── Why 18 and not the game's hole count ───────────────────────────────────
 *
 * `holeWeight` doubles a hole when `hole > 18 - n` against a literal
 * `ROUND_HOLES = 18` (src/lib/gloriousHoles.ts), deliberately — on a shorter
 * round nothing clears the threshold and GFH is inert. The guard uses the same
 * 18 so the cap and the weighting cannot disagree.
 */

let ctx: TestContext;
let tripId: string;
const gameIds: string[] = [];

interface Fixture {
  gameId: string;
  matchId: string;
  compId: string;
  teamA: string;
  teamB: string;
}

/**
 * A live outcome-mode match-play game with one match, plus a cup so the points
 * half of the reopen case is observable.
 *
 * `entry_mode: 'outcome'` is required, not incidental: `gloriousConfig` returns
 * NO_GLORIOUS for score entry and migration 104 refuses that combination
 * outright, so a score-mode game could never exercise any of this.
 */
async function fixture(name: string): Promise<Fixture> {
  const owner = ctx.getUser("owner").id;
  const member = ctx.getUser("member").id;
  const compId = await ctx.createCompetition(tripId, `${name} cup`);
  const teamA = await ctx.createTeam(compId, "Alpha", { shortName: "ALP" });
  const teamB = await ctx.createTeam(compId, "Bravo", { shortName: "BRV" });
  await ctx.admin.from("team_assignments").insert([
    { competition_id: compId, user_id: owner, team_id: teamA },
    { competition_id: compId, user_id: member, team_id: teamB },
  ]);
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_match_play", name, competitionId: compId,
  })) as { id: string };
  gameIds.push(g.id);
  await ctx.admin.from("games").update({
    status: "active", scoring_enabled: true, entry_mode: "outcome",
    points_total: 10, points_distribution: { type: "per_match", value: 10 },
    // The engine reads its hole count from here (`loadStrokeIndex`).
    scorecard_schema: { units: { count: 18, label: "hole" } },
  }).eq("id", g.id);
  const matchId = crypto.randomUUID();
  await ctx.admin.from("game_matches").insert({
    id: matchId, game_id: g.id, match_number: 1, display_order: 1,
    side_a: { type: "user", id: owner }, side_b: { type: "user", id: member },
  });
  return { gameId: g.id, matchId, compId, teamA, teamB };
}

/** Side A wins holes 1..`aWins`, halves the rest through `thru`. */
async function play(f: Fixture, aWins: number, thru: number) {
  const owner = ctx.getUser("owner").id;
  await ctx.admin.from("match_hole_outcomes").delete().eq("match_id", f.matchId);
  const rows = [];
  for (let h = 1; h <= aWins; h++)
    rows.push({ id: crypto.randomUUID(), game_id: f.gameId, match_id: f.matchId, hole_number: h, result: "side_a", submitted_by: owner });
  for (let h = aWins + 1; h <= thru; h++)
    rows.push({ id: crypto.randomUUID(), game_id: f.gameId, match_id: f.matchId, hole_number: h, result: "halved", submitted_by: owner });
  const { error } = await ctx.admin.from("match_hole_outcomes").insert(rows);
  // `'halve'` is not a legal value — the constraint takes `'halved'`. A silent
  // batch rejection here leaves zero rows and every assertion below becomes a
  // statement about an empty game, which is how three earlier probes reported
  // confident nonsense.
  if (error) throw new Error(`fixture outcomes rejected: ${error.message}`);
}

/** Set modifiers directly — the PRIOR state a save is then judged against. */
async function setModifiers(f: Fixture, mods: Record<string, Record<string, unknown>>) {
  await ctx.admin.from("games").update({ modifiers: mods }).eq("id", f.gameId);
}

/** Save through the real procedure, with `modifiers` as the only thing changing. */
async function save(f: Fixture, mods: Record<string, Record<string, unknown>>) {
  const { data: g } = await ctx.admin.from("games").select("*").eq("id", f.gameId).single();
  const hash = (await ctx.caller().games.configHash({ tripId, gameId: f.gameId })).hash;
  return ctx.caller().games.saveConfig({
    tripId, gameId: f.gameId, baseHash: hash,
    payload: {
      name: g!.name as string,
      rulesForToday: (g!.rules_for_today as string | null) ?? null,
      scoringEnabled: true,
      pointsTotal: (g!.points_total as number | null) ?? 10,
      pointsDistribution: g!.points_distribution ?? null,
      courseId: null, backCourseId: null,
      scorecardSchema: g!.scorecard_schema ?? null,
      delegates: [],
      modifiers: mods,
      // Structure UNCHANGED — a clean-replace would re-mint the match id and
      // orphan the outcomes this whole file is about.
      matchesStructureDirty: false,
      groupsStructureDirty: false,
    },
  });
}

const matchRow = async (f: Fixture) =>
  (await ctx.admin.from("game_matches").select("status, result, margin").eq("id", f.matchId).single()).data;

const GFH = (n: number) => ({ glorious_holes: { holes: n } });

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Glorious Played Holes Trip");
  await ctx.addTripMemberById(tripId, ctx.getUser("member").id, "Member");
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("match_hole_outcomes").delete().in("game_id", gameIds);
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("GFH already ON, a hole inside the window has been played — FROZEN", () => {
  /**
   * The case a cap-only build gets wrong, and the one a code review cannot see.
   * GFH on at N=3 (window 16-18) with a group through 16: every direction
   * revalues hole 16, which has already been played DOUBLED.
   */
  it("refuses lowering N — the change a cap would wave through", async () => {
    const f = await fixture("frozen-lower");
    await setModifiers(f, GFH(3));
    await play(f, 2, 16);
    await expect(save(f, GFH(2))).rejects.toThrow(/can no longer be changed/);
  });

  it("refuses turning it OFF", async () => {
    const f = await fixture("frozen-off");
    await setModifiers(f, GFH(3));
    await play(f, 2, 16);
    await expect(save(f, {})).rejects.toThrow(/can no longer be changed/);
  });

  it("refuses raising N", async () => {
    const f = await fixture("frozen-raise");
    await setModifiers(f, GFH(3));
    await play(f, 2, 16);
    await expect(save(f, GFH(4))).rejects.toThrow(/can no longer be changed/);
  });

  it("offers NO cap in the message — a number here would name an action that fails", async () => {
    // The refusal must not say "you can only use 2": at N=2 the window is 17-18,
    // and getting there still de-weights the played hole 16. Every value is
    // refused, so a capped sentence would send the reader to a setting that also
    // refuses. Asserted as the ABSENCE of the cap wording, because that is the
    // difference between this message and the correct one for the next case.
    const f = await fixture("frozen-nocap");
    await setModifiers(f, GFH(3));
    await play(f, 2, 16);
    await expect(save(f, GFH(2))).rejects.toThrow(/can no longer be changed/);
    await expect(save(f, GFH(2))).rejects.not.toThrow(/you can only use/);
  });

  it("still allows a save that leaves glorious ALONE", async () => {
    // The guard judges a CHANGE, not the presence of the setting. Every other
    // field shares this Save, so a frozen game that could not be renamed would
    // be a worse bug than the one being fixed.
    const f = await fixture("frozen-unchanged");
    await setModifiers(f, GFH(3));
    await play(f, 2, 16);
    await expect(save(f, GFH(3))).resolves.toBeDefined();
  });
});

describe("GFH off — the cap, and it names the right number", () => {
  it("permits N at the limit and refuses one above it", async () => {
    // Through 16 → only holes 17 and 18 are unplayed → maxN = 2.
    const f = await fixture("cap-boundary");
    await play(f, 2, 16);
    await expect(save(f, GFH(3))).rejects.toThrow(/already played 16 holes/);
    // The number, not merely that something was refused. A guard refusing with
    // the wrong cap is worse than one refusing vaguely.
    await expect(save(f, GFH(3))).rejects.toThrow(/you can only use 2 glorious finishing holes/);
    await expect(save(f, GFH(2))).resolves.toBeDefined();
  });

  it("singularises the cap at 1", async () => {
    const f = await fixture("cap-one");
    await play(f, 2, 17);
    await expect(save(f, GFH(2))).rejects.toThrow(/you can only use 1 glorious finishing hole\./);
  });

  it("is unrestricted when nothing has been played", async () => {
    const f = await fixture("cap-empty");
    await expect(save(f, GFH(9))).resolves.toBeDefined();
  });
});

describe("a group has finished play — not applicable", () => {
  it("refuses entirely, without offering a cap of zero", async () => {
    const f = await fixture("finished");
    await play(f, 2, 18);
    await expect(save(f, GFH(3))).rejects.toThrow(/is not applicable/);
    await expect(save(f, GFH(3))).rejects.not.toThrow(/you can only use/);
  });
});

describe("a PERMITTED change recomputes — the freeze must not swallow it", () => {
  /**
   * The original reported bug, and the case that fails against a build which
   * guards correctly but leaves `skipComplete: true`.
   *
   * 4 up with 3 to play is over unweighted (4 > 3). Turning GFH on at N=3 makes
   * the remaining swing 6, which exceeds the 4-hole lead — so the match is no
   * longer decided and the stored result must say so.
   */
  it("reopens a decided match, and the cup points follow", async () => {
    const f = await fixture("reopen");
    await play(f, 4, 15);
    await ctx.caller().games.finish({ tripId, gameId: f.gameId });

    expect(await matchRow(f)).toMatchObject({ status: "complete", result: "a_win", margin: "4&3" });
    const decided = await ctx.caller().competitions.leaderboard({ tripId, competitionId: f.compId });
    expect(decided.teamTotals[f.teamA]).toBe(10);

    // Through 15 → maxN = 3, so N=3 is permitted rather than refused.
    await ctx.caller().games.openCorrection({ tripId, gameId: f.gameId });
    await expect(save(f, GFH(3))).resolves.toBeDefined();

    expect(await matchRow(f)).toMatchObject({ status: "active", result: null, margin: null });
    const reopened = await ctx.caller().competitions.leaderboard({ tripId, competitionId: f.compId });
    expect(reopened.teamTotals[f.teamA]).toBe(0);
    expect(reopened.teamTotals[f.teamB]).toBe(0);
  });

  /**
   * The other direction, which needs no flag and must keep working.
   *
   * Turning GFH off REDUCES the remaining swing, so it can close a match out.
   * An undecided match is not `complete`, so the freeze never sees it — this
   * path is correct today. Asserted anyway so a future change to the flag's
   * condition cannot silently break the half that was never broken.
   */
  it("closes out an undecided match when GFH is turned off", async () => {
    const f = await fixture("closeout");
    await setModifiers(f, GFH(3));
    // Through 15, so no hole in the 16-18 window has been played — turning it
    // off revalues nothing and is permitted.
    await play(f, 4, 15);
    await ctx.caller().games.finish({ tripId, gameId: f.gameId });
    // 4 up, weighted swing 6 → NOT over while glorious is on.
    expect(await matchRow(f)).toMatchObject({ status: "active", result: null });

    await ctx.caller().games.openCorrection({ tripId, gameId: f.gameId });
    await expect(save(f, {})).resolves.toBeDefined();
    // Swing back to 3 < 4 → decided.
    expect(await matchRow(f)).toMatchObject({ status: "complete", result: "a_win", margin: "4&3" });
  });
});
