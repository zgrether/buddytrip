import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const MATCH_PLAY = "gtt_match_play_singles";
const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const IDX = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];

let ctx: TestContext;
let tripId: string;
const courseIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Course Picker Trip");
});

afterAll(async () => {
  // Courses are global (not trip-scoped) — clean them up explicitly.
  for (const id of courseIds) await ctx.admin.from("courses").delete().eq("id", id);
  await ctx.cleanup();
});

describe("courses router — global library", () => {
  it("create saves a course with par + a valid stroke-index permutation", async () => {
    const course = await ctx.caller().courses.create({
      name: "Pebble Creek",
      location: "Bend, OR",
      holeCount: 18,
      par: PAR,
      handicapIndex: IDX,
      teeSets: [{ name: "White", yards: Array(18).fill(350) }],
      source: "manual",
    });
    courseIds.push(course.id as string);
    expect(course.par).toEqual(PAR);
    expect(course.handicap_index).toEqual(IDX);
    expect(course.source).toBe("manual");
    expect(course.hole_count).toBe(18);
  });

  it("create rejects a duplicated stroke index (broken permutation)", async () => {
    const bad = [...IDX];
    bad[1] = bad[0]; // duplicate
    await expect(
      ctx.caller().courses.create({ name: "Bad Idx", holeCount: 18, par: PAR, handicapIndex: bad })
    ).rejects.toThrow(/permutation/i);
  });

  it("create rejects a par/index length mismatch", async () => {
    await expect(
      ctx.caller().courses.create({ name: "Short", holeCount: 18, par: PAR.slice(0, 17), handicapIndex: IDX })
    ).rejects.toThrow(/18 entries/i);
  });

  it("saves an index-less course (par only) and snapshots par WITHOUT an index", async () => {
    const course = await ctx.caller().courses.create({
      name: "Gross Only GC",
      holeCount: 18,
      par: PAR,
      hasStrokeIndex: false,
    });
    courseIds.push(course.id as string);
    expect(course.has_stroke_index).toBe(false);
    expect(course.handicap_index).toEqual([]);

    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Gross" });
    const updated = await ctx.caller().games.applyCourse({ tripId, gameId: game.id as string, courseId: course.id as string });
    const schema = updated!.scorecard_schema as { units: { metadata: { par: number[]; handicap_index?: number[] } } };
    expect(schema.units.metadata.par).toEqual(PAR);
    // No index → handicap_index OMITTED; strokeHoles falls back to sequential.
    expect(schema.units.metadata.handicap_index).toBeUndefined();
  });

  it("persists the FULL per-tee record — ratings + yards (mig 059)", async () => {
    const course = await ctx.caller().courses.create({
      name: "Full Tee GC",
      holeCount: 18,
      par: PAR,
      handicapIndex: IDX,
      source: "golfcourseapi",
      providerId: "gca-7788",
      teeSets: [
        { name: "Blue", courseRating: 72.3, slopeRating: 131, bogeyRating: 95.1, yards: Array(18).fill(410) },
        { name: "White", courseRating: 70.1, slopeRating: 124, bogeyRating: 92, yards: Array(18).fill(380) },
      ],
    });
    courseIds.push(course.id as string);
    expect(course.source).toBe("golfcourseapi");
    expect(course.provider_id).toBe("gca-7788");
    const tees = course.tee_sets as Array<{
      name: string;
      courseRating: number | null;
      slopeRating: number | null;
      bogeyRating: number | null;
      yards: (number | null)[];
    }>;
    expect(tees).toHaveLength(2);
    expect(tees[0]).toMatchObject({ name: "Blue", courseRating: 72.3, slopeRating: 131, bogeyRating: 95.1 });
    expect(tees[1]).toMatchObject({ name: "White", slopeRating: 124 });
  });

  it("list + getById surface a saved course", async () => {
    const list = await ctx.caller().courses.list({ limit: 50 });
    expect(list.some((c: { id: string }) => c.id === courseIds[0])).toBe(true);
    const one = await ctx.caller().courses.getById({ courseId: courseIds[0] });
    expect(one.name).toBe("Pebble Creek");
  });
});

describe("games.applyCourse — the contract snapshot", () => {
  it("snapshots par + handicap_index into the game's scorecard_schema + keeps course_id", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Singles" });
    const course = await ctx.caller().courses.create({
      name: "Snapshot GC",
      holeCount: 18,
      par: PAR,
      handicapIndex: IDX,
    });
    courseIds.push(course.id as string);

    const updated = await ctx.caller().games.applyCourse({
      tripId,
      gameId: game.id as string,
      courseId: course.id as string,
    });
    const schema = updated!.scorecard_schema as {
      units: { metadata: { par: number[]; handicap_index: number[] }; count: number };
    };
    expect(schema.units.metadata.par).toEqual(PAR);
    expect(schema.units.metadata.handicap_index).toEqual(IDX);
    expect(schema.units.count).toBe(18);
    expect(updated!.course_id).toBe(course.id);
  });

  it("is frozen once a score exists (re-apply blocked)", async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Frozen" });
    const course = await ctx.caller().courses.create({
      name: "Frozen GC",
      holeCount: 18,
      par: PAR,
      handicapIndex: IDX,
    });
    courseIds.push(course.id as string);

    await ctx.caller().games.applyCourse({ tripId, gameId: game.id as string, courseId: course.id as string });

    // A score lands → the par/index it's played on is frozen.
    await ctx.admin.from("score_entries").insert({
      id: crypto.randomUUID(),
      game_id: game.id,
      participant_id: ctx.user.id,
      participant_type: "user",
      unit_label: "1",
      value: 4,
    });

    await expect(
      ctx.caller().games.applyCourse({ tripId, gameId: game.id as string, courseId: course.id as string })
    ).rejects.toThrow(/already entered|can't be changed/i);
  });
});
