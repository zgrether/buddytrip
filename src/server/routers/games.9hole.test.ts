import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { validateStrokeIndex } from "../../lib/courseIndex";
import { unitsFromSchema, strokeIndexOf } from "../../lib/strokePlayConfig";
import { strokeHoles } from "../../lib/matchPlay";

const STROKE_PLAY = "gtt_stroke_play";

/**
 * W-9HOLE-01 — setBackNine integration, on REAL INDEXED data (the September/BBMI
 * prerequisite flagged in W-GAMEPAGE-01 §6.4). #465 shipped the composeTwoNines
 * unit test + an eye-check on an INDEX-OFF course, so the real server path
 * (applyCourse 9-hole front → setBackNine 9-hole back → composed 18 snapshot) had
 * never been asserted producing a correct interleaved stroke index + handicap
 * allocation. This closes that: two real indexed nines through the actual router.
 */
describe("games.setBackNine — indexed two-nines compose (W-9HOLE-01)", () => {
  let ctx: TestContext;
  let tripId: string;
  let gameId: string;
  let frontId: string;
  let backId: string;
  let back2Id: string;

  // Two real 1..9 stroke indexes (distinct, non-trivial permutations).
  const fIdx = [5, 1, 7, 3, 9, 2, 8, 4, 6];
  const bIdx = [3, 7, 1, 9, 5, 8, 2, 6, 4];
  const b2Idx = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const par9 = [4, 3, 5, 4, 4, 3, 5, 4, 4];
  const createdCourses: string[] = []; // courses are global — track for teardown

  async function makeNine(name: string, index: number[]) {
    const c = await ctx.caller().courses.create({
      name, holeCount: 9, par: par9, handicapIndex: index, hasStrokeIndex: true,
      teeSets: [{ name: "White", yards: Array(9).fill(350) }], source: "manual",
    });
    createdCourses.push(c.id as string);
    return c.id as string;
  }
  async function make18(name: string) {
    const c = await ctx.caller().courses.create({
      name, holeCount: 18, par: Array(18).fill(4),
      handicapIndex: Array.from({ length: 18 }, (_, i) => i + 1), hasStrokeIndex: true,
      teeSets: [{ name: "White", yards: Array(18).fill(350) }], source: "manual",
    });
    createdCourses.push(c.id as string);
    return c.id as string;
  }
  const schemaOf = async () => {
    const g = await ctx.caller().games.getById({ tripId, gameId });
    return (g as { scorecard_schema: { units: { count: number; metadata: { par: number[]; handicap_index?: number[] } } } | null }).scorecard_schema;
  };

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("9-hole compose");
    const game = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Two Nines" });
    gameId = game.id;
    frontId = await makeNine(`Front 9 ${Date.now()}`, fIdx);
    backId = await makeNine(`Back 9 ${Date.now()}`, bIdx);
    back2Id = await makeNine(`Back 9b ${Date.now()}`, b2Idx);
  });

  afterAll(async () => {
    if (createdCourses.length) await ctx.admin.from("courses").delete().in("id", createdCourses);
    await ctx.cleanup();
  });

  it("a 9-hole front applies as a 9-hole schema (a lone front — needs a back)", async () => {
    await ctx.caller().games.applyCourse({ tripId, gameId, courseId: frontId });
    const s = await schemaOf();
    expect(s?.units.count).toBe(9);
    expect(s?.units.metadata.par).toHaveLength(9);
  });

  it("setBackNine composes a full 18 with the INTERLEAVED stroke index (front odd, back even)", async () => {
    await ctx.caller().games.setBackNine({ tripId, gameId, backCourseId: backId });
    const s = await schemaOf();
    expect(s?.units.count).toBe(18);
    // par concatenates front then back
    expect(s?.units.metadata.par).toEqual([...par9, ...par9]);
    const idx = s?.units.metadata.handicap_index;
    expect(idx).toHaveLength(18);
    // front holes 1-9 take ODD overall ranks (2·SI−1); back holes 10-18 take EVEN (2·SI)
    expect(idx!.slice(0, 9)).toEqual(fIdx.map((s) => 2 * s - 1));
    expect(idx!.slice(9)).toEqual(bIdx.map((s) => 2 * s));
    // and it's a valid 1..18 permutation
    expect(validateStrokeIndex(idx!, 18).valid).toBe(true);
  });

  it("handicap allocation spreads across BOTH nines on real indexed data (the fairness point)", async () => {
    const strokeIndex = strokeIndexOf(unitsFromSchema(await schemaOf()));
    // A 5-stroke player gets the 5 hardest holes (overall index 1..5).
    const holes = [...strokeHoles(5, strokeIndex, 18)].sort((a, b) => a - b);
    expect(holes).toHaveLength(5);
    expect(holes.some((h) => h <= 9)).toBe(true);   // some on the front
    expect(holes.some((h) => h >= 10)).toBe(true);  // some on the back — NOT all front
  });

  it("swap preserves the front nine's index and replaces only the back", async () => {
    const before = (await schemaOf())!.units.metadata.handicap_index!;
    await ctx.caller().games.setBackNine({ tripId, gameId, backCourseId: back2Id });
    const after = (await schemaOf())!.units.metadata.handicap_index!;
    expect(after.slice(0, 9)).toEqual(before.slice(0, 9));      // front untouched
    expect(after.slice(9)).toEqual(b2Idx.map((s) => 2 * s));    // back is the new nine
    expect(after.slice(9)).not.toEqual(before.slice(9));        // and it actually changed
    expect(validateStrokeIndex(after, 18).valid).toBe(true);
  });

  it("rejects an 18-hole course as the back nine", async () => {
    const eighteen = await make18(`Real 18 ${Date.now()}`);
    await expect(
      ctx.caller().games.setBackNine({ tripId, gameId, backCourseId: eighteen })
    ).rejects.toThrow(/9-hole/);
  });

  it("rejects setBackNine on a real 18-hole course (not a two-nines front)", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Real 18 game" });
    const eighteen = await make18(`Real 18b ${Date.now()}`);
    await ctx.caller().games.applyCourse({ tripId, gameId: g.id, courseId: eighteen });
    await expect(
      ctx.caller().games.setBackNine({ tripId, gameId: g.id, backCourseId: backId })
    ).rejects.toThrow();
  });

  // W-GAMEPAGE-01 pin #3 — the back nine INHERITS the front's tee. The composed
  // tee NAME is always the front's; the back-9 YARDAGE comes from the same-named
  // tee on the back course, falling back to the back's first tee when absent.
  it("back-nine tee inherits the front's tee name; falls back to the back's first tee when absent", async () => {
    const teeYards = (g: { scorecard_schema: unknown }) =>
      (g.scorecard_schema as { units: { metadata: { tee: { name: string; yards: number[] } } } }).units.metadata.tee;

    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Tee inherit" });
    const front = await ctx.caller().courses.create({
      name: `TF ${Date.now()}`, holeCount: 9, par: par9, handicapIndex: fIdx, hasStrokeIndex: true,
      teeSets: [{ name: "White", yards: Array(9).fill(350) }], source: "manual",
    });
    createdCourses.push(front.id as string);
    await ctx.caller().games.applyCourse({ tripId, gameId: g.id, courseId: front.id }); // front tee = White

    // INHERIT-MATCH: back course lists Blue FIRST, then White (distinct yards). With
    // no explicit tee, the back-9 yards must come from White (inherit) — NOT Blue (first).
    const backMatch = await ctx.caller().courses.create({
      name: `TBM ${Date.now()}`, holeCount: 9, par: par9, handicapIndex: bIdx, hasStrokeIndex: true,
      teeSets: [{ name: "Blue", yards: Array(9).fill(500) }, { name: "White", yards: Array(9).fill(300) }], source: "manual",
    });
    createdCourses.push(backMatch.id as string);
    await ctx.caller().games.setBackNine({ tripId, gameId: g.id, backCourseId: backMatch.id });
    let tee = teeYards(await ctx.caller().games.getById({ tripId, gameId: g.id }));
    expect(tee.name).toBe("White"); // composed name = the front's
    expect(tee.yards.slice(9)).toEqual(Array(9).fill(300)); // inherited White on the back, not Blue (first)

    // FALLBACK: swap to a back with NO White (only Gold). Back-9 yards fall back to
    // the first tee (Gold); the composed name still reads the front's White.
    const backNoMatch = await ctx.caller().courses.create({
      name: `TBN ${Date.now()}`, holeCount: 9, par: par9, handicapIndex: b2Idx, hasStrokeIndex: true,
      teeSets: [{ name: "Gold", yards: Array(9).fill(411) }], source: "manual",
    });
    createdCourses.push(backNoMatch.id as string);
    await ctx.caller().games.setBackNine({ tripId, gameId: g.id, backCourseId: backNoMatch.id });
    tee = teeYards(await ctx.caller().games.getById({ tripId, gameId: g.id }));
    expect(tee.name).toBe("White"); // still the front's name
    expect(tee.yards.slice(9)).toEqual(Array(9).fill(411)); // fell back to Gold (the back's first tee)
  });
});
