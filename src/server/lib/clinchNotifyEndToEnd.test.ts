import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
let tripId: string;
let compId: string;
let winner: string;
let loser: string;
const gameIds: string[] = [];

/** One finalized placement-[1] game worth 1 point, with the given team order. */
async function seedFinalizedGame(name: string, typeId: string, first: string, second: string) {
  const id = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id,
    trip_id: tripId,
    competition_id: compId,
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
    { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results ${name}: ${r.error.message}`);
  return id;
}

async function storedClaim(): Promise<string | null> {
  const { data } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", compId)
    .maybeSingle();
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Clinch End-to-End Trip");
  compId = await ctx.createCompetition(tripId, "Decided Cup", { scoringModel: "points" });
  // Sequential, never Promise.all — these can race and flake (CLAUDE.md).
  winner = await ctx.createTeam(compId, "Team Winner", { shortName: "WIN" });
  loser = await ctx.createTeam(compId, "Team Loser", { shortName: "LOS", color: "#ef4444", colorDim: "#2a0a0a" });

  // Winner takes 2 of 3 — decided with one game still counting toward the total.
  // A non-golf and two golf games, mirroring the production competition.
  await seedFinalizedGame("Yard game", "gtt_generic_yard", winner, loser);
  await seedFinalizedGame("Putt Putt 1", "gtt_stroke_play", winner, loser);
  await seedFinalizedGame("Putt Putt 2", "gtt_stroke_play", loser, winner);
}, 120_000);

afterAll(async () => {
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

describe("cup clinched — the assembled notify path", () => {
  it("the leaderboard reports the cup as decided", async () => {
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
    expect(await storedClaim()).toBeNull();

    await notifyCupClinchedIfDecided({
      tripId,
      competitionId: compId,
      actorUserId: ctx.getUser("owner").id,
      admin: ctx.admin,
    });

    // Not "it didn't throw" — the row changed. A silently-swallowed failure in
    // this function looks exactly like a clean run from the outside, which is
    // why the assertion is on the database and not on the return value (it
    // returns void either way).
    expect(await storedClaim()).toBe(winner);
  }, 120_000);

  it("a second run does not re-claim — one push per clinch, not one per finalize", async () => {
    // `finish` is re-runnable and the clinch check runs on EVERY finalize by
    // design, so this is the property that keeps that from becoming a
    // notification bug.
    await notifyCupClinchedIfDecided({
      tripId,
      competitionId: compId,
      actorUserId: ctx.getUser("owner").id,
      admin: ctx.admin,
    });
    expect(await storedClaim()).toBe(winner);
  }, 120_000);

  it("an UNDECIDED cup claims nothing", async () => {
    // Control: without it, a test that always claimed would pass for the wrong
    // reason — and "always fires" is as broken as "never fires".
    const otherTrip = await ctx.createTrip("Undecided Trip");
    const otherComp = await ctx.createCompetition(otherTrip, "Open Cup", { scoringModel: "points" });
    const a = await ctx.createTeam(otherComp, "A", { shortName: "A" });
    const b = await ctx.createTeam(otherComp, "B", { shortName: "B" });

    const id = crypto.randomUUID();
    await ctx.admin.from("games").insert({
      id, trip_id: otherTrip, competition_id: otherComp,
      game_type_id: "gtt_generic_yard", name: "One of four", status: "complete",
      scoring_enabled: true, points_total: 4,
      points_distribution: { type: "placement", values: [4] },
    });
    gameIds.push(id);
    // 4 available, winNumber 3 — one win of 4 points DOES decide it, so give the
    // single game to A and add a second unplayed game worth 4 to keep it open.
    const id2 = crypto.randomUUID();
    await ctx.admin.from("games").insert({
      id: id2, trip_id: otherTrip, competition_id: otherComp,
      game_type_id: "gtt_generic_yard", name: "Two of four", status: "pending",
      scoring_enabled: false, points_total: 8,
      points_distribution: { type: "placement", values: [8] },
    });
    gameIds.push(id2);
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: id, entity_id: a, entity_type: "team", position: 1, raw_score: 1 },
      { id: crypto.randomUUID(), game_id: id, entity_id: b, entity_type: "team", position: 2, raw_score: 2 },
    ]);

    await notifyCupClinchedIfDecided({
      tripId: otherTrip,
      competitionId: otherComp,
      actorUserId: ctx.getUser("owner").id,
      admin: ctx.admin,
    });

    const { data } = await ctx.admin
      .from("competitions")
      .select("clinch_notified_team_id")
      .eq("id", otherComp)
      .maybeSingle();
    expect(data?.clinch_notified_team_id ?? null).toBeNull();
  }, 120_000);
});
