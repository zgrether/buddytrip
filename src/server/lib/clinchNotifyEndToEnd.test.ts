import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { notifyCupClinchedIfDecided } from "./gameFinishNotify";

/**
 * The clinch notification, END TO END: a decided cup must DETECT a clincher and
 * LAND the claim.
 *
 * ── Why this test exists ─────────────────────────────────────────────────────
 * Production had a competition sitting clinched with `clinch_notified_team_id`
 * NULL — the highest-value push in the app, silently not sent. Every piece of
 * that path had unit coverage (`clinchClaim.test.ts` pins the claim's
 * exactly-once semantics; the leaderboard has its own suites) and the ASSEMBLED
 * path had none. So the one thing nobody could answer was the only thing that
 * mattered: given a real clinched competition, does the claim get written?
 *
 * The fixture is the production competition's exact shape, reproduced: two
 * teams, three placement-[1] games worth one point each, finalized so one team
 * takes two. Available 3 → winNumber 2 → that team sits on 2, i.e.
 * `pointsToClinch = 0`, which is `<= 0` and therefore decided.
 *
 * ── What it deliberately does NOT test ───────────────────────────────────────
 * Delivery. The push no-ops here (no VAPID locally), and that is the point: the
 * claim is written BEFORE the send, so it must land regardless. That ordering is
 * what makes a set claim evidence of DETECTION rather than of delivery — the
 * property the production diagnosis leaned on. If a future change moves the
 * claim after the send, this test still passes but that inference dies; treat
 * the ordering as load-bearing.
 */

let ctx: TestContext;
const gameIds: string[] = [];
const compIds: string[] = [];

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527). The cases shared one: "writes the
 * claim" asserted the column started NULL, and "a second run does not
 * re-claim" needed that claim to exist. Shuffled, the first met a claim the
 * second had already made.
 */
type Cup = { tripId: string; compId: string; winner: string; loser: string };

/** One finalized placement-[1] game worth 1 point, with the given team order. */
async function seedFinalizedGame(cup: Pick<Cup, "tripId" | "compId">, name: string, typeId: string, first: string, second: string) {
  const id = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id,
    trip_id: cup.tripId,
    competition_id: cup.compId,
    game_type_id: typeId,
    name,
    status: "complete",
    scoring_enabled: true,
    points_total: 1,
    points_distribution: { type: "placement", values: [1] },
  });
  if (g.error) throw new Error(`seed game ${name}: ${g.error.message}`);
  gameIds.push(id);
  const r = await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results ${name}: ${r.error.message}`);
  return id;
}

/** Winner takes 2 of 3 — decided with one game still counting toward the total. */
async function decidedCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Clinch End-to-End ${label}`);
  // Head to head: only a head-to-head cup fires a CUP clinch (ruling 4, PR 4).
  const compId = await ctx.createCompetition(tripId, `Decided Cup ${label}`, { scoringModel: "match_play" });
  compIds.push(compId);
  // Sequential, never Promise.all — these can race and flake (CLAUDE.md).
  const winner = await ctx.createTeam(compId, "Team Winner", { shortName: "WIN" });
  const loser = await ctx.createTeam(compId, "Team Loser", { shortName: "LOS", color: "#ef4444", colorDim: "#2a0a0a" });
  // A non-golf and two golf games, mirroring the production competition.
  const cup = { tripId, compId, winner, loser };
  await seedFinalizedGame(cup, "Yard game", "gtt_generic_yard", winner, loser);
  await seedFinalizedGame(cup, "Putt Putt 1", "gtt_stroke_play", winner, loser);
  await seedFinalizedGame(cup, "Putt Putt 2", "gtt_stroke_play", loser, winner);
  return cup;
}

async function storedClaim(compId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", compId)
    .single();
  if (error) throw new Error(`read claim: ${error.message}`);
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

async function notify(cup: Pick<Cup, "tripId" | "compId">) {
  await notifyCupClinchedIfDecided({
    tripId: cup.tripId,
    competitionId: cup.compId,
    actorUserId: ctx.getUser("owner").id,
    admin: ctx.admin,
  });
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  // push_send_log has no FK (migration 105), so cleanup() does not sweep it.
  if (compIds.length) await ctx.admin.from("push_send_log").delete().in("competition_id", compIds);
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

describe("cup clinched — the assembled notify path", () => {
  it("the leaderboard reports the cup as decided", async () => {
    const { compId, winner, loser } = await decidedCup("board");
    const board = await computeCompetitionLeaderboard(ctx.admin, compId);
    const totals = (board.teamTotals ?? {}) as Record<string, number>;
    const toClinch = (board.pointsToClinch ?? {}) as Record<string, number>;

    expect(board.pointsAvailable).toBe(3);
    expect(board.winNumber).toBe(2); // smallest 0.5-step strictly above half
    expect(totals[winner]).toBe(2);
    expect(totals[loser]).toBe(1);

    // The EXACT predicate `notifyCupClinchedIfDecided` uses — asserted here so a
    // change to either side shows up as a failure in the place that explains it.
    expect(toClinch[winner]).toBeLessThanOrEqual(0);
    expect(toClinch[loser]).toBeGreaterThan(0);
  }, 120_000);

  it("running the notify path WRITES THE CLAIM — the step production never took", async () => {
    const cup = await decidedCup("claim");
    expect(await storedClaim(cup.compId)).toBeNull();

    await notify(cup);

    // Not "it didn't throw" — the row changed. A silently-swallowed failure in
    // this function looks exactly like a clean run from the outside, which is
    // why the assertion is on the database and not on the return value (it
    // returns void either way).
    expect(await storedClaim(cup.compId)).toBe(cup.winner);
  }, 120_000);

  it("a second run does not re-claim — one push per clinch, not one per finalize", async () => {
    // `finish` is re-runnable and the clinch check runs on EVERY finalize by
    // design, so this is the property that keeps that from becoming a
    // notification bug.
    //
    // The stored team alone cannot show it: a second claim for the SAME team
    // leaves the column holding the same winner, so asserting the column after
    // the second run passed whether or not it re-claimed. What separates the two
    // is the second run's own verdict, which it logs.
    const cup = await decidedCup("second-run");
    await notify(cup);
    expect(await storedClaim(cup.compId)).toBe(cup.winner); // premise: the first run claimed

    const lines: string[] = [];
    const capture = (msg: unknown) => {
      if (typeof msg === "string") lines.push(msg);
    };
    const infoSpy = vi.spyOn(console, "info").mockImplementation(capture);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(capture);
    try {
      await notify(cup);
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
    const verdicts = lines
      .filter((l) => l.startsWith("[push] clinch check:"))
      .map((l) => l.replace("[push] clinch check: ", ""));
    expect(verdicts).toEqual(["entry", "already_claimed"]);
    expect(await storedClaim(cup.compId)).toBe(cup.winner);
  }, 120_000);

  it("an UNDECIDED cup claims nothing", async () => {
    // Control: without it, a test that always claimed would pass for the wrong
    // reason — and "always fires" is as broken as "never fires".
    const otherTrip = await ctx.createTrip("Undecided Trip");
    // Head to head: only a head-to-head cup fires a CUP clinch (ruling 4, PR 4).
    const otherComp = await ctx.createCompetition(otherTrip, "Open Cup", { scoringModel: "match_play" });
    compIds.push(otherComp);
    const a = await ctx.createTeam(otherComp, "A", { shortName: "A" });
    const b = await ctx.createTeam(otherComp, "B", { shortName: "B" });

    const id = crypto.randomUUID();
    const g1 = await ctx.admin.from("games").insert({
      id, trip_id: otherTrip, competition_id: otherComp,
      game_type_id: "gtt_generic_yard", name: "One of four", status: "complete",
      scoring_enabled: true, points_total: 4,
      points_distribution: { type: "placement", values: [4] },
    });
    if (g1.error) throw new Error(`seed game: ${g1.error.message}`);
    gameIds.push(id);
    // 4 available, winNumber 3 — one win of 4 points DOES decide it, so give the
    // single game to A and add a second unplayed game worth 4 to keep it open.
    const id2 = crypto.randomUUID();
    const g2 = await ctx.admin.from("games").insert({
      id: id2, trip_id: otherTrip, competition_id: otherComp,
      game_type_id: "gtt_generic_yard", name: "Two of four", status: "pending",
      scoring_enabled: false, points_total: 8,
      points_distribution: { type: "placement", values: [8] },
    });
    if (g2.error) throw new Error(`seed game: ${g2.error.message}`);
    gameIds.push(id2);
    const r = await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: id, entity_id: a, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
      { id: crypto.randomUUID(), game_id: id, entity_id: b, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
    ]);
    if (r.error) throw new Error(`seed results: ${r.error.message}`);

    await notify({ tripId: otherTrip, compId: otherComp });

    expect(await storedClaim(otherComp)).toBeNull();
  }, 120_000);
});
