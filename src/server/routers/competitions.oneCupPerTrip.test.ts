import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * Migration 195 — one competition per trip is the DATABASE's rule.
 *
 * Before 195 the only guard was `competitions.create`'s read-first `if`, and
 * two concurrent creates could both pass it. Two claims, each deterministic:
 *
 *  1. A second competition row for the same trip is REFUSED by the constraint —
 *     whatever inserts it. Control: another trip still admits one, so the rule is
 *     per trip, not a global cap.
 *  2. When `competitions.create` reaches the constraint (the race its read-first
 *     check cannot see), the caller gets the same CONFLICT and sentence as the
 *     read-first branch — not a 500. The race is made deterministic by failing
 *     the read-first query (`callerFailingRead`): the router ignores that read's
 *     error, so the insert proceeds exactly as it would for the losing side of a
 *     real race.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const insertCup = (tripId: string, name: string) =>
  ctx.admin.from("competitions").insert({ id: `test-comp-${crypto.randomUUID()}`, trip_id: tripId, name });

describe("the constraint", () => {
  it("CONTROL: two different trips each hold one competition", async () => {
    const t1 = await ctx.createTrip("One cup A");
    const t2 = await ctx.createTrip("One cup B");
    expect((await insertCup(t1, "Cup A")).error).toBeNull();
    expect((await insertCup(t2, "Cup B")).error).toBeNull();
  }, 60_000);

  it("a second competition on the same trip is refused by the database", async () => {
    const t = await ctx.createTrip("Two cups");
    expect((await insertCup(t, "First")).error).toBeNull();
    const second = await insertCup(t, "Second");
    expect(second.error?.code).toBe("23505");
    expect(second.error?.message).toContain("competitions_one_per_trip");
    const { count } = await ctx.admin.from("competitions").select("id", { count: "exact", head: true }).eq("trip_id", t);
    expect(count).toBe(1);
  }, 60_000);
});

describe("competitions.create when the race reaches the constraint", () => {
  it("CONTROL: the read-first branch refuses a second create with CONFLICT", async () => {
    const tripId = await ctx.createTrip("Read-first refusal");
    await ctx.caller().competitions.create({ tripId, name: "First", scoringModel: "points" });
    await expect(ctx.caller().competitions.create({ tripId, name: "Second", scoringModel: "points" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A competition already exists for this trip",
    });
  }, 60_000);

  it("past a read-first check that saw nothing, the constraint's refusal is the same CONFLICT, not a 500", async () => {
    const tripId = await ctx.createTrip("Race refusal");
    await ctx.caller().competitions.create({ tripId, name: "Winner of the race", scoringModel: "points" });

    // The losing side of a race: its read-first check saw no competition.
    const blind = callerFailingRead(ctx, "owner", { table: "competitions", columns: "id" });
    await expect(blind.competitions.create({ tripId, name: "Loser of the race", scoringModel: "points" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A competition already exists for this trip",
    });
    const { count } = await ctx.admin.from("competitions").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
    expect(count).toBe(1);
  }, 60_000);
});
