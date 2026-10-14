import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";

/**
 * W-9HOLE-01 — a 9-hole course applied through `games.applyCourse` lands as a
 * lone FRONT nine (a 9-hole schema the course row reads as "needs a back nine").
 *
 * This file used to drive the whole two-nines flow through the server:
 * `applyCourse` front → `games.setBackNine` back → the composed 18. #1624
 * retired `setBackNine` (no screen called it; the settings page composes with
 * `buildComposedCourseSnapshot` and saves the result through `save_game_config`),
 * so its cases moved to that builder's own tests in `src/lib/courseSnapshot.test.ts`:
 * the interleaved index, a swap to a different back, tee inheritance by name and
 * the first-tee fallback, the refusals, and handicap allocation across both nines.
 * `applyCourse` is still live (rack's setup screen), so its 9-hole case stays here.
 */
type Schema = { units: { count: number; metadata: { par: number[]; handicap_index?: number[] } } } | null;

describe("games.applyCourse — a 9-hole course lands as a lone front (W-9HOLE-01)", () => {
  let ctx: TestContext;
  let tripId: string;
  let frontId: string;
  const createdCourses: string[] = []; // courses are global — track for teardown

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("9-hole front");
    const c = await ctx.caller().courses.create({
      name: `Front 9 ${Date.now()}`, holeCount: 9, par: [4, 3, 5, 4, 4, 3, 5, 4, 4],
      handicapIndex: [5, 1, 7, 3, 9, 2, 8, 4, 6], hasStrokeIndex: true,
      teeSets: [{ name: "White", yards: Array(9).fill(350) }], source: "manual",
    });
    frontId = c.id as string;
    createdCourses.push(frontId);
  });

  afterAll(async () => {
    if (createdCourses.length) await ctx.admin.from("courses").delete().in("id", createdCourses);
    await ctx.cleanup();
  });

  it("a 9-hole front applies as a 9-hole schema (a lone front — needs a back)", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Lone Front" });
    await ctx.caller().games.applyCourse({ tripId, gameId: game.id, courseId: frontId });
    const g = await ctx.caller().games.getById({ tripId, gameId: game.id });
    const s = (g as { scorecard_schema: Schema }).scorecard_schema;
    expect(s?.units.count).toBe(9);
    expect(s?.units.metadata.par).toHaveLength(9);
  });
});
