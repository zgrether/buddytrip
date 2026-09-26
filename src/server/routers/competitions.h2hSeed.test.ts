import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { createCallerFactory, type TRPCContext } from "../trpc";
import { appRouter } from "../router";

/**
 * `competitions.create` — a head-to-head cup's two teams are part of the create
 * (ruling 2, PR 4).
 *
 * Team seeding used to be best-effort for every cup: a failed seed left the
 * competition standing, on the grounds that "the team builder can still add
 * teams". That holds for a points race and not for head to head, whose team
 * editor hides add — so a head-to-head cup whose seed failed could never reach
 * the two teams it is defined by. Now its create fails, and the half-made cup
 * is removed.
 *
 * The seed failure is injected: the caller's client is the real authenticated
 * owner client, with ONLY the `teams` insert made to fail. Everything else — the
 * competition insert, the undo delete, the read-back — goes to the database, so
 * what is asserted about the competition row is real.
 *
 * Each case is one a wrong build gets wrong: no throw (the teamless cup
 * survives), a throw with no undo (the row survives the error), or the rule
 * applied to every cup (a points race loses its best-effort seed).
 */

const factory = createCallerFactory(appRouter);

let ctx: TestContext;

/** The owner's real client, with `teams` inserts refused. */
function seedFailingCaller() {
  const real = ctx.authedClient("owner");
  const failingTeams = { insert: () => Promise.resolve({ data: null, error: { message: "injected seed failure" } }) };
  const client = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (table: string) =>
        table === "teams"
          ? failingTeams
          : (Reflect.get(target, "from", receiver) as (t: string) => unknown).call(target, table);
    },
  }) as SupabaseClient;
  const user = ctx.getUser("owner");
  const trpcCtx: TRPCContext = { supabase: client, user: { id: user.id, email: user.email }, membershipCache: new Map() };
  return factory(trpcCtx);
}

/** A trip holds at most one competition (`competitions.create` refuses a second), so each case has its own. */
async function competitionsOn(tripId: string): Promise<{ id: string }[]> {
  const { data } = await ctx.admin.from("competitions").select("id").eq("trip_id", tripId);
  return (data ?? []) as { id: string }[];
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("competitions.create — a head-to-head cup's two teams are part of the create", () => {
  it("fails the create when the teams can't be seeded, and leaves no half-made cup", async () => {
    const tripId = await ctx.createTrip("H2H Seedless");
    await expect(
      seedFailingCaller().competitions.create({ tripId, name: "Seedless H2H", scoringModel: "match_play" }),
    ).rejects.toThrow("Failed to create the cup's two teams, so the cup wasn't created: injected seed failure");
    expect(await competitionsOn(tripId)).toEqual([]);
  }, 60_000);

  it("keeps a points race's seed best-effort — the create succeeds, teamless, and the builder can add teams", async () => {
    const tripId = await ctx.createTrip("Points Seedless");
    const created = await seedFailingCaller().competitions.create({
      tripId, name: "Seedless Points", scoringModel: "points", teamCount: 3,
    });
    ctx.trackCompetition(created.id);
    expect(await competitionsOn(tripId)).toEqual([{ id: created.id }]);
  }, 60_000);

  it("a head-to-head create that seeds normally has exactly its two teams", async () => {
    const tripId = await ctx.createTrip("H2H Seeded");
    const created = await ctx.caller().competitions.create({ tripId, name: "Seeded H2H", scoringModel: "match_play" });
    ctx.trackCompetition(created.id);
    const { count } = await ctx.admin
      .from("teams").select("id", { count: "exact", head: true }).eq("competition_id", created.id);
    expect(count).toBe(2);
  }, 60_000);
});
