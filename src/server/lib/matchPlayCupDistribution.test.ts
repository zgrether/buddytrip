import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * A MATCH-PLAY cup can hold a manual game that carries its own placement split.
 *
 * ── What actually changed ───────────────────────────────────────────────────
 * `competitions.scoring_model` is one column holding two axes. It was introduced
 * to branch the non-golf RESULT MODEL — a per-game question — but lives on the
 * competition, and it also carries genuinely competition-level duties (the
 * 2-team lock, the board layout, the hero, the projection pills). The per-game
 * axis already existed: `points_distribution`'s SHAPE.
 *
 * The leaderboard's manual-game branch sat above the shape dispatch and returned
 * first, so the competition-level flag overrode the per-game field. It now defers
 * when a split is actually configured. That is a REMOVED OVERRIDE, not new
 * capability — which is why the first test here is the unchanged behaviour, and
 * why it is written first: winner-take-all is still what a manual game with no
 * split of its own does, in every cup, exactly as before.
 *
 * ── The precondition this rests on, and how it actually stood ──────────────
 * The claim that this change is inert for existing data was CHECKED against
 * production rather than assumed, and it was WRONG: seven manual games in
 * match-play cups already carry `{placement, [9,6]}`. All seven are in one
 * development trip ("D1 Trip", 2026-06-17), all have zero entered results, and
 * all have a null `points_total` — so today they award nothing and contribute
 * nothing, and after this change they contribute 15 points-available each while
 * still awarding nothing. No real cup holds one. The last test pins the
 * null-total case, because it is the shape those rows actually have.
 */

const MANUAL = "gtt_manual";

let ctx: TestContext;
let tripId: string;
const gameIds: string[] = [];

/** A match-play cup with two teams — BBMI's shape, and the default everywhere. */
async function matchPlayCup(name: string): Promise<{ comp: string; ta: string; tb: string }> {
  const comp = await ctx.createCompetition(tripId, name); // omitted → DB default 'match_play'
  const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
  const tb = await ctx.createTeam(comp, "B", { shortName: "B" });
  return { comp, ta, tb };
}

async function manualGame(
  comp: string,
  name: string,
  cols: { points_total?: number | null; points_distribution?: unknown }
): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: MANUAL, name, competitionId: comp })) as { id: string };
  gameIds.push(g.id);
  await ctx.admin.from("games").update(cols).eq("id", g.id);
  return g.id;
}

/** A finished manual game: team A first, team B second. */
async function finishFirstSecond(gameId: string, ta: string, tb: string) {
  await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: gameId, entity_id: ta, entity_type: "team", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: gameId, entity_id: tb, entity_type: "team", position: 2, raw_score: 2 },
  ]);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("MatchPlay Distribution Trip");
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("match-play cup — a manual game with NO split of its own is unchanged", () => {
  it("winner takes the whole total; the loser gets nothing", async () => {
    const { comp, ta, tb } = await matchPlayCup("WTA Cup");
    const gameId = await manualGame(comp, "Cornhole", { points_total: 8, points_distribution: null });
    await finishFirstSecond(gameId, ta, tb);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(8);
    expect(lb.teamTotals[tb]).toBe(0);
    expect(lb.pointsAvailable).toBe(8);
  });

  it("a TIE splits the total — the averaged convention, still applied", async () => {
    const { comp, ta, tb } = await matchPlayCup("Tie Cup");
    const gameId = await manualGame(comp, "Tied Cornhole", { points_total: 8, points_distribution: null });
    // Both at position 1 is how a tie is recorded; placementPoints averages [8,0].
    await ctx.admin.from("game_results").insert([
      { id: crypto.randomUUID(), game_id: gameId, entity_id: ta, entity_type: "team", position: 1, raw_score: 1 },
      { id: crypto.randomUUID(), game_id: gameId, entity_id: tb, entity_type: "team", position: 1, raw_score: 1 },
    ]);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(4);
    expect(lb.teamTotals[tb]).toBe(4);
  });
});

describe("match-play cup — a manual game WITH its own split is awarded by it", () => {
  it("the split decides the payout, not winner-take-all", async () => {
    const { comp, ta, tb } = await matchPlayCup("Split Cup");
    const gameId = await manualGame(comp, "Cornhole", {
      points_total: 8,
      points_distribution: { type: "placement", values: [5, 3] },
    });
    await finishFirstSecond(gameId, ta, tb);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    // The whole point: second place is worth something now. Under the override
    // this was 8 / 0.
    expect(lb.teamTotals[ta]).toBe(5);
    expect(lb.teamTotals[tb]).toBe(3);
    expect(lb.pointsAvailable).toBe(8);
  });

  it("a PER_MATCH distribution on a manual game still flattens — the narrow scope", async () => {
    // Deliberately excluded. `per_match` is match play's own shape and the branch
    // that handles it derives a match count from pairings a manual game does not
    // have, so deferring for it would read a count of zero rather than do
    // something sensible. Only `placement` defers.
    const { comp, ta, tb } = await matchPlayCup("PerMatch Manual Cup");
    const gameId = await manualGame(comp, "Odd One", {
      points_total: 6,
      points_distribution: { type: "per_match", value: 3 },
    });
    await finishFirstSecond(gameId, ta, tb);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(6);
    expect(lb.teamTotals[tb]).toBe(0);
  });

  it("a split with a NULL total — the shape the seven production rows actually have", async () => {
    // Those rows are `{placement, [9,6]}` with `points_total` null. Before this
    // change they contributed NOTHING (the flatten read total 0 → distribution
    // null → skipped). After it they fall to the placement branch, where a null
    // total falls back to the distribution sum. Pinned so the one real
    // consequence of the precondition being false is a tested number rather than
    // a claim in a PR body.
    const { comp, ta, tb } = await matchPlayCup("Null Total Cup");
    const gameId = await manualGame(comp, "Legacy Shape", {
      points_total: null,
      points_distribution: { type: "placement", values: [9, 6] },
    });

    const before = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(before.pointsAvailable).toBe(15); // 9 + 6, derived from the split
    expect(before.teamTotals[ta]).toBe(0); // …but nothing awarded with no results

    await finishFirstSecond(gameId, ta, tb);
    const after = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(after.teamTotals[ta]).toBe(9);
    expect(after.teamTotals[tb]).toBe(6);
  });
});

describe("points cup — untouched by any of this", () => {
  it("still awards by its split", async () => {
    const comp = await ctx.createCompetition(tripId, "Points Cup", { scoringModel: "points" });
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });
    const gameId = await manualGame(comp, "Points Cornhole", {
      points_total: 8,
      points_distribution: { type: "placement", values: [5, 3] },
    });
    await finishFirstSecond(gameId, ta, tb);

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(5);
    expect(lb.teamTotals[tb]).toBe(3);
  });
});
