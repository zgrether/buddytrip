import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { notifyCupClinchedIfDecided } from "./gameFinishNotify";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { isCupShared } from "@/lib/cupCompletion";

/**
 * A SHARED Cup never sends a clinch push (Zach's ruling, 2026-10-22).
 *
 * Two head-to-head games, each won by a different team for the same points:
 * level, every game final, nobody clinched. The board reads it as shared, and
 * the clinch check run at the last finalize finds nobody decided, holds no
 * claim and records `no_clincher`. The control is the same Cup with one team
 * winning both: it claims, which proves this fixture can produce a clinch.
 *
 * Each case builds its own Cup; finalized games are seeded with their result
 * rows, as `clinchOutcomeLogging.test.ts` does.
 */

let ctx: TestContext;
const gameIds: string[] = [];
const compIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);
afterAll(async () => {
  if (compIds.length) await ctx.admin.from("push_send_log").delete().in("competition_id", compIds);
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

async function finishedGame(tripId: string, compId: string, name: string, first: string, second: string) {
  const id = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: compId, game_type_id: "gtt_generic_yard",
    name, status: "complete", scoring_enabled: true,
    points_total: 2, points_distribution: { type: "placement", values: [2] },
  });
  if (g.error) throw new Error(`seed game ${name}: ${g.error.message}`);
  gameIds.push(id);
  const r = await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results ${name}: ${r.error.message}`);
}

async function cup(label: string, secondGameWinner: "a" | "b") {
  const tripId = await ctx.createTrip(`Shared cup ${label}`);
  const compId = await ctx.createCompetition(tripId, `Shared Cup ${label}`, { scoringModel: "match_play" });
  compIds.push(compId);
  const a = await ctx.createTeam(compId, "Alpha", { shortName: "ALP" });
  const b = await ctx.createTeam(compId, "Bravo", { shortName: "BRA", color: "#ef4444", colorDim: "#2a0a0a" });
  await finishedGame(tripId, compId, "g1", a, b);
  await finishedGame(tripId, compId, "g2", secondGameWinner === "a" ? a : b, secondGameWinner === "a" ? b : a);
  return { tripId, compId, a, b };
}

const claimHeld = async (compId: string) =>
  ((await ctx.admin.from("competitions").select("clinch_notified_team_id").eq("id", compId).single()).data?.clinch_notified_team_id as string | null) ?? null;
const lastOutcome = async (compId: string) =>
  ((await ctx.admin.from("push_send_log").select("outcome, created_at").eq("competition_id", compId).order("created_at", { ascending: false }).limit(1)).data?.[0]?.outcome as string | undefined) ?? null;

describe("a shared Cup", () => {
  it("reads shared on the board, and the clinch check sends nothing", async () => {
    const { tripId, compId, a, b } = await cup("level", "b");
    const board = await computeCompetitionLeaderboard(ctx.admin, compId);
    const totals = [board.unitTotals[a] ?? 0, board.unitTotals[b] ?? 0];
    expect(totals).toEqual([2, 2]);
    const clinched = [a, b].some((t) => (board.pointsToClinch[t] ?? 1) <= 0);
    expect(clinched).toBe(false);
    expect(isCupShared(board.games, clinched, totals)).toBe(true);

    await notifyCupClinchedIfDecided({ tripId, competitionId: compId, actorUserId: ctx.getUser("owner").id, admin: ctx.admin });
    expect(await claimHeld(compId)).toBeNull();
    expect(await lastOutcome(compId)).toBe("no_clincher");
  }, 60_000);

  it("CONTROL: one team winning both games clinches, and the check claims it", async () => {
    const { tripId, compId, a } = await cup("decided", "a");
    await notifyCupClinchedIfDecided({ tripId, competitionId: compId, actorUserId: ctx.getUser("owner").id, admin: ctx.admin });
    expect(await claimHeld(compId)).toBe(a);
  }, 60_000);
});
