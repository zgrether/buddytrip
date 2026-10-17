import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const IDX = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];

let ctx: TestContext;
const courseIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
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

  it("saves an index-less course (par only) — the row stores no index", async () => {
    const course = await ctx.caller().courses.create({
      name: "Gross Only GC",
      holeCount: 18,
      par: PAR,
      hasStrokeIndex: false,
    });
    courseIds.push(course.id as string);
    expect(course.has_stroke_index).toBe(false);
    expect(course.handicap_index).toEqual([]);
    // Its snapshot (par only, no index) is the builder's job, pinned in
    // courseSnapshot.test.ts ("an index-OFF course snapshots par only").
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
        // Bogey rating 101.7 is a REAL value (Pebble Beach Blue) that exceeds a
        // bogey golfer's "100" intuition — guards the max(99) bound bug that
        // verify-by-eye caught (the import silently failed on real data).
        { name: "Blue", courseRating: 72.3, slopeRating: 131, bogeyRating: 101.7, yards: Array(18).fill(410) },
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
    expect(tees[0]).toMatchObject({ name: "Blue", courseRating: 72.3, slopeRating: 131, bogeyRating: 101.7 });
    expect(tees[1]).toMatchObject({ name: "White", slopeRating: 124 });
  });

  it("accepts 15 tee sets — Pebble Beach's real golfcourseapi count, which the old max(12) rejected", async () => {
    // golfcourseapi tags male/female tees separately and combo tees ("White/Green
    // Combo") duplicate that split again — Pebble Beach itself returns 15 distinct
    // tee sets (measured live 2026-08-24). A cap that rejects real data is not a
    // guard, it's a landmine; this pins the raised ceiling against the actual
    // count rather than an arbitrary smaller one that would pass by accident.
    const names = [
      "Blue", "Gold", "Gold/White Combo", "White", "White/Green Combo", "Green",
      "Green/Red Combo", "Red", "Gold (W)", "Gold/White Combo (W)", "White (W)",
      "White/Green Combo (W)", "Green (W)", "Green/Red Combo (W)", "Red (W)",
    ];
    expect(names).toHaveLength(15);
    const course = await ctx.caller().courses.create({
      name: "Fifteen Tee GC",
      holeCount: 18,
      par: PAR,
      handicapIndex: IDX,
      source: "golfcourseapi",
      teeSets: names.map((name) => ({ name, yards: Array(18).fill(400) })),
    });
    courseIds.push(course.id as string);
    expect((course.tee_sets as unknown[]).length).toBe(15);
  });

  it("still rejects an absurd tee-set count (the cap exists for a reason)", async () => {
    const names = Array.from({ length: 31 }, (_, i) => `Tee ${i}`);
    await expect(
      ctx.caller().courses.create({
        name: "Too Many Tees GC",
        holeCount: 18,
        par: PAR,
        handicapIndex: IDX,
        teeSets: names.map((name) => ({ name, yards: Array(18).fill(400) })),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", cause: { issues: [{ path: ["teeSets"] }] } });
  });

  it("list + getById surface a saved course", async () => {
    // Saves its own course (#1527): it used to read `courseIds[0]`, the course the
    // FIRST case happened to create, so a reordered run read some other course.
    const name = `List Me ${Date.now()}`;
    const saved = await ctx.caller().courses.create({ name, holeCount: 18, par: PAR, handicapIndex: IDX });
    courseIds.push(saved.id as string);
    const list = await ctx.caller().courses.list({ limit: 50 });
    expect(list.some((c: { id: string }) => c.id === saved.id)).toBe(true);
    const one = await ctx.caller().courses.getById({ courseId: saved.id as string });
    expect(one.name).toBe(name);
  });

  it("search — local name ILIKE finds a saved course (the free typeahead path)", async () => {
    // A uniquely-named course so the ILIKE match is unambiguous across the suite.
    const unique = `Zzz Local Search ${Date.now()}`;
    const c = await ctx.caller().courses.create({ name: unique, holeCount: 18, par: PAR, handicapIndex: IDX });
    courseIds.push(c.id as string);

    const hits = await ctx.caller().courses.search({ q: unique.slice(0, 12) });
    expect(hits.some((h: { id: string }) => h.id === c.id)).toBe(true);

    // A non-matching term returns nothing for this course.
    const miss = await ctx.caller().courses.search({ q: "qqq-no-such-course-xyz" });
    expect(miss.some((h: { id: string }) => h.id === c.id)).toBe(false);
  });
});

describe("courses router — golfcourseapi daily counter (Phase 4)", () => {
  it("record_api_call increments under the limit then caps at it (atomic gate)", async () => {
    // Throwaway provider + tiny limit so the cap is reachable without 50 calls
    // and the real golfcourseapi counter is untouched.
    const P = `__test_cap_${Date.now()}__`;
    const c1 = await ctx.admin.rpc("record_api_call", { p_provider: P, p_limit: 2 });
    const c2 = await ctx.admin.rpc("record_api_call", { p_provider: P, p_limit: 2 });
    const c3 = await ctx.admin.rpc("record_api_call", { p_provider: P, p_limit: 2 });
    expect(c1.data).toBe(1);
    expect(c2.data).toBe(2);
    expect(c3.data).toBe(-1); // at cap → no increment, signals "do not fire"
    await ctx.admin.from("api_usage_daily").delete().eq("provider", P);
  });

  it("a call taken as a signed-in user shows in apiUsage", async () => {
    // The golf routes take the cap with the caller's own client
    // (`takeGolfApiCall`), so this is the same call through the same grant.
    const before = await ctx.caller().courses.apiUsage();
    const { data: count, error } = await ctx
      .authedClient("owner")
      .rpc("record_api_call", { p_provider: "golfcourseapi", p_limit: 50 });
    expect(error).toBeNull();
    expect(count).toBe(before.count + 1);

    const after = await ctx.caller().courses.apiUsage();
    expect(after.count).toBe(before.count + 1);
    expect(after.limit).toBe(50);
    expect(after.atCap).toBe(false);

    // Clean up today's golfcourseapi row — no real API calls happen in test, so
    // the counter should return to empty for the next run.
    const today = new Date().toISOString().slice(0, 10);
    await ctx.admin.from("api_usage_daily").delete().eq("provider", "golfcourseapi").eq("usage_date", today);
  });
});
