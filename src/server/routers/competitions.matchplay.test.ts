import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * W-NONGOLF-02 — match-play (win/lose/tie) non-golf scoring.
 *
 * A `match_play` competition (the DB default) awards a non-golf MANUAL game
 * winner-take-all: the winner takes the game's `points_total`, a tie splits it
 * (placementPoints averages [P,0] → P/2 — the same averaged convention a golf
 * match-play halve uses). A `points` competition keeps #430's placement model
 * (the configured distribution). The branch is on `competitions.scoring_model`,
 * NOT team count. Verified through the leaderboard endpoint (same isolation
 * pattern as competitions.d1followon.test.ts).
 */

const MANUAL = "gtt_manual";

let ctx: TestContext;
let tripId: string;
const gameIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("MatchPlay NonGolf Trip");
});

afterAll(async () => {
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 30000);

describe("match_play (default) — non-golf game scores winner-take-all", () => {
  it("winner takes the game's points; loser gets 0", async () => {
    const comp = await ctx.createCompetition(tripId, "MP Win Comp");
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });
    // pointsTotal only, NO distribution — winner-take-all is derived from total.
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Poker", competitionId: comp, pointsTotal: 5,
    })) as { id: string };
    gameIds.push(g.id);

    // Win/lose/tie posts winner → position 1, loser → position 2.
    await ctx.caller().games.post({
      tripId, gameId: g.id,
      placements: [{ entityId: ta, position: 1 }, { entityId: tb, position: 2 }],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(5); // winner takes all
    expect(lb.teamTotals[tb]).toBe(0);
    expect(lb.pointsAvailable).toBe(5); // winner-take-all [5,0] → 5 in play
  });

  it("a tie splits the points evenly (P/2 each)", async () => {
    const comp = await ctx.createCompetition(tripId, "MP Tie Comp");
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Cornhole", competitionId: comp, pointsTotal: 5,
    })) as { id: string };
    gameIds.push(g.id);

    // Tie → BOTH at position 1 (placementPoints averages [5,0] → 2.5 each).
    await ctx.caller().games.post({
      tripId, gameId: g.id,
      placements: [{ entityId: ta, position: 1 }, { entityId: tb, position: 1 }],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(2.5);
    expect(lb.teamTotals[tb]).toBe(2.5);
  });
});

describe("points comp — keeps #430's placement model (regression)", () => {
  it("the configured distribution awards per position, NOT winner-take-all", async () => {
    const comp = await ctx.createCompetition(tripId, "Points Comp");
    const ta = await ctx.createTeam(comp, "A", { shortName: "A" });
    const tb = await ctx.createTeam(comp, "B", { shortName: "B" });
    // Flip this comp to the points scoring model (independent of its 2 teams).
    await ctx.admin.from("competitions").update({ scoring_model: "points" }).eq("id", comp);

    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: MANUAL, name: "Ranked", competitionId: comp,
      pointsTotal: 8, pointsDistribution: { type: "placement", values: [5, 3] },
    })) as { id: string };
    gameIds.push(g.id);

    await ctx.caller().games.post({
      tripId, gameId: g.id,
      placements: [{ entityId: ta, position: 1 }, { entityId: tb, position: 2 }],
    });

    const lb = await ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });
    expect(lb.teamTotals[ta]).toBe(5); // the configured split — not winner-take-all 8
    expect(lb.teamTotals[tb]).toBe(3);
  });
});
