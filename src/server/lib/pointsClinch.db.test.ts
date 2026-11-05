import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * A points cup's place locks, read off the real board (spec §1). The math is
 * pinned in `pointsClinch.test.ts`; this pins what the board feeds it: banked
 * points only, and unbanked games with their real awards.
 */

let ctx: TestContext;
let tripId: string;
let comp: string;
let teams: string[];

/** A manual game paying `values`, finished in the order given by `places`. */
async function manualGame(name: string, values: number[], places?: string[]) {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_generic_yard", name, competitionId: comp })) as { id: string };
  await ctx.admin
    .from("games")
    .update({ points_total: values.reduce((a, b) => a + b, 0), points_distribution: { type: "placement", values } })
    .eq("id", g.id);
  if (places) {
    await ctx.caller().games.finish({ tripId, gameId: g.id, placements: places.map((entityId, i) => ({ entityId, position: i + 1 })) });
  }
  return g.id;
}

const board = () => ctx.caller().competitions.leaderboard({ tripId, competitionId: comp });

beforeAll(async () => {
  ctx = await TestContext.create();
  ({ tripId, competitionId: comp, teamIds: teams } = await ctx.createCupTrip({
    title: "Clinch Trip",
    name: "Clinch Cup",
    scoringModel: "points",
    teams: ["Alpha", "Bravo", "Charlie"],
  }));
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("the board's clinch", () => {
  it("clinches once the lead passes what is left, and adding a game takes it back", async () => {
    const [a, b, c] = teams;
    await manualGame("Cornhole", [10, 4, 1], [a, b, c]);
    const left = await manualGame("Darts", [5, 1]);

    // A 10, B 4, C 1, with Darts left: B can gain 5 on A at most, and 6 is more.
    const first = await board();
    expect(first.clinch?.clincherId).toBe(a);
    expect(first.clinch?.lockedUnitIds).toContain(a);
    expect(first.clinch?.lockedUnitIds).not.toContain(b);

    const added = await manualGame("Pool", [8, 1]);
    const second = await board();
    expect(second.clinch?.clincherId).toBeNull();
    expect(second.clinch?.lockedUnitIds).toEqual([]);

    await ctx.admin.from("games").delete().in("id", [left, added]);
  });

  it("nothing left: every place is locked", async () => {
    const final = await board();
    expect(new Set(final.clinch?.lockedUnitIds)).toEqual(new Set(teams));
  });

  it("a head-to-head Cup has no clinch here: it keeps its own rule", async () => {
    const cup = await ctx.createCupTrip({ title: "H2H Trip", name: "H2H Cup", teams: ["One", "Two"] });
    const lb = await ctx.caller().competitions.leaderboard({ tripId: cup.tripId, competitionId: cup.competitionId });
    expect(lb.clinch).toBeNull();
  });
});
