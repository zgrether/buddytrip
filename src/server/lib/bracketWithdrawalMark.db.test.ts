import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 209, the database half of ruling 8: `archive_trip_member` marks a
 * bracket entrant WITHDRAWN when its last member still on the trip leaves a
 * bracket being played. Driven through the archive RPC on a bracket built
 * directly — no app code — because this PR lands before the resolvers that read
 * the mark (the app half, with its own router tests, follows).
 *
 * Fixture rows are faithful to what `save_game_config` writes: entrant ids are
 * `<game>:e<seed>` (migration 115) and every member row names a trip member.
 * Each case builds its own trip (destructive writes, CLAUDE.md).
 */

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function trip(label: string) {
  const tripId = await ctx.createTrip(`Withdrawal mark ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  return tripId;
}

/** A bracket game with one entrant per seed, members as given. */
async function bracket(tripId: string, seeds: string[][], status: "active" | "complete" = "active") {
  const gameId = `wm-${crypto.randomUUID()}`;
  const g = await ctx.admin.from("games").insert({ id: gameId, trip_id: tripId, game_type_id: "gtt_generic_card", status });
  if (g.error) throw g.error;
  for (const [i, users] of seeds.entries()) {
    const id = `${gameId}:e${i + 1}`;
    const e = await ctx.admin.from("bracket_entrants").insert({ id, game_id: gameId, seed: i + 1, team_id: null });
    if (e.error) throw e.error;
    const m = await ctx.admin.from("bracket_entrant_members").insert(users.map((user_id) => ({ entrant_id: id, user_id })));
    if (m.error) throw m.error;
  }
  return gameId;
}

async function withdrawn(gameId: string, seed: number) {
  const { data, error } = await ctx.admin.from("bracket_entrants").select("withdrawn_at").eq("id", `${gameId}:e${seed}`).single();
  if (error) throw error;
  return data.withdrawn_at !== null;
}

const remove = (tripId: string, userId: string) =>
  ctx.authedClient("owner").rpc("archive_trip_member", { p_trip_id: tripId, p_user_id: userId });

describe("an entrant withdraws when its last member leaves", () => {
  it("the sole member leaves: their entrant is marked; nobody else's is", async () => {
    const tripId = await trip("sole");
    const gameId = await bracket(tripId, [[owner], [planner], [member], [outsider]]);
    expect((await remove(tripId, member)).error).toBeNull();
    expect(await withdrawn(gameId, 3)).toBe(true);
    for (const s of [1, 2, 4]) expect(await withdrawn(gameId, s)).toBe(false);
  });

  it("a PARTNERSHIP: the partner plays on; marked only when its last member leaves, and member rows stay", async () => {
    const tripId = await trip("partners");
    const gameId = await bracket(tripId, [[owner, planner], [member, outsider]]);
    expect((await remove(tripId, member)).error).toBeNull();
    expect(await withdrawn(gameId, 2)).toBe(false);
    expect((await remove(tripId, outsider)).error).toBeNull();
    expect(await withdrawn(gameId, 2)).toBe(true);
    const { count } = await ctx.admin.from("bracket_entrant_members")
      .select("user_id", { count: "exact", head: true }).eq("entrant_id", `${gameId}:e2`);
    expect(count).toBe(2);
  });

  it("a FINISHED bracket is untouched, while an unfinished one beside it is marked", async () => {
    // The unfinished one is not decoration: the archive's clean-up runs only when
    // the trip has an unfinished game, so it is what makes "skipped" observable.
    const tripId = await trip("finished");
    const done = await bracket(tripId, [[owner], [member]], "complete");
    const live = await bracket(tripId, [[planner], [member]]);
    expect((await remove(tripId, member)).error).toBeNull();
    expect(await withdrawn(done, 2)).toBe(false);
    expect(await withdrawn(live, 2)).toBe(true);
  });
});
