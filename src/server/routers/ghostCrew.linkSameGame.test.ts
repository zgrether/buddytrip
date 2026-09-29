import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * #1481 / migration 197 — the owner link REFUSES whenever the placeholder and
 * the account are both in the same game AT ALL (ruled 2026-09-28).
 *
 * Migration 190 refused only a score for the SAME HOLE. Several formats record a
 * person in a game with no `score_entries` at all, so two identities who both
 * played one of those reached the merge, which silently dropped the
 * placeholder's result (194) or put one person on both sides of a match.
 *
 * Each case builds its own trips, placeholder and game: a successful link
 * DELETES the placeholder, so no case may inherit another's state.
 *
 * Through the real caller the account cannot be on the link's own trip (the
 * router refuses that), so the shared game always sits on a SECOND trip both
 * identities are on — the merge is global.
 */

let ctx: TestContext;
let realId: string;
let realEmail: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  realId = ctx.getUser("outsider").id;
  realEmail = ctx.getUser("outsider").email;
});

afterAll(async () => {
  await ctx.cleanup();
});

type Seed = { tripId: string; ghostId: string; secondTripId: string };

/** A placeholder on trip A, and a second trip B that both identities are on. */
async function seedPair(label: string): Promise<Seed> {
  const tripId = await ctx.createTrip(`Link ${label}`);
  const ghost = (await ctx.caller().ghostCrew.create({ tripId, name: `Ghost ${label}`, role: "Member" })) as { id: string };
  const secondTripId = await ctx.createTrip(`Shared ${label}`);
  await ctx.addTripMemberById(secondTripId, realId, "Member");
  const tm = await ctx.admin.from("trip_members").insert({ trip_id: secondTripId, user_id: ghost.id, role: "Member", status: "in" });
  if (tm.error) throw new Error(`seed ghost membership: ${tm.error.message}`);
  return { tripId, ghostId: ghost.id, secondTripId };
}

async function game(tripId: string, name: string, status = "active", gameTypeId = "gtt_match_play"): Promise<string> {
  const id = genId("game");
  const { error } = await ctx.admin.from("games").insert({ id, trip_id: tripId, game_type_id: gameTypeId, name, status });
  if (error) throw new Error(`seed game: ${error.message}`);
  return id;
}

async function insertOrThrow(table: string, row: Record<string, unknown>) {
  const { error } = await ctx.admin.from(table).insert(row);
  if (error) throw new Error(`seed ${table}: ${error.message}`);
}

async function link(s: Seed): Promise<TRPCError | null> {
  try {
    await ctx.caller().ghostCrew.update({ tripId: s.tripId, guestUserId: s.ghostId, email: realEmail });
    return null;
  } catch (e) {
    if (e instanceof TRPCError) return e;
    throw e;
  }
}

async function ghostExists(ghostId: string) {
  const { data } = await ctx.admin.from("users").select("id").eq("id", ghostId).maybeSingle();
  return !!data;
}

/** The refusal, asserted on OUR sentence and the game it names. */
function expectRefusal(err: TRPCError | null, gameName: string) {
  expect(err, "the link went through — nothing refused the shared game").not.toBeNull();
  expect(err!.code).toBe("CONFLICT");
  expect(err!.message).toContain(`are both in ${gameName}`);
  // It names what the owner can do, not only the fault.
  expect(err!.message).toMatch(/separate crew members/);
  expect(err!.message).not.toMatch(/Failed to link|duplicate key/);
}

describe("owner link refuses a shared game, whatever records the person (#1481)", () => {
  it("both are SIDES of one match with no score_entries at all (outcome mode)", async () => {
    const s = await seedPair("sides");
    const g = await game(s.secondTripId, "Sides Match");
    const matchId = genId("gm");
    await insertOrThrow("game_matches", {
      id: matchId, game_id: g, match_number: 1,
      side_a: { type: "user", id: s.ghostId }, side_b: { type: "user", id: realId },
    });

    expectRefusal(await link(s), "Sides Match");

    // Refused BEFORE the merge: the placeholder and both sides are untouched.
    expect(await ghostExists(s.ghostId)).toBe(true);
    const { data: m } = await ctx.admin.from("game_matches").select("side_a, side_b").eq("id", matchId).single();
    expect(m).toEqual({ side_a: { type: "user", id: s.ghostId }, side_b: { type: "user", id: realId } });
  }, 60000);

  it("both are only PARTICIPANTS — no scores, no results (\"in the same game at all\")", async () => {
    const s = await seedPair("participants");
    const g = await game(s.secondTripId, "Roster Only Game");
    await insertOrThrow("game_participants", { id: genId("gp"), game_id: g, user_id: s.ghostId });
    await insertOrThrow("game_participants", { id: genId("gp"), game_id: g, user_id: realId });

    expectRefusal(await link(s), "Roster Only Game");
    expect(await ghostExists(s.ghostId)).toBe(true);
  }, 60000);

  it("scores on DIFFERENT holes of one game — the same-hole check let this through", async () => {
    const s = await seedPair("holes");
    const g = await game(s.secondTripId, "Different Holes Game", "active", "gtt_stroke_play");
    for (const [pid, unit] of [[s.ghostId, "3"], [realId, "11"]] as const) {
      await insertOrThrow("score_entries", {
        id: genId("se"), game_id: g, participant_id: pid, participant_type: "user",
        unit_label: unit, value: 4, annotations: {}, submitted_at: new Date().toISOString(),
      });
    }

    expectRefusal(await link(s), "Different Holes Game");
    expect(await ghostExists(s.ghostId)).toBe(true);
  }, 60000);

  it("both hold a RESULT row in a finished game with no scores — the merge used to drop the placeholder's", async () => {
    const s = await seedPair("results");
    const g = await game(s.secondTripId, "Placement Game", "complete", "gtt_generic_card");
    for (const [pid, pos] of [[s.ghostId, 1], [realId, 2]] as const) {
      await insertOrThrow("game_results", {
        id: crypto.randomUUID(), game_id: g, entity_id: pid, entity_type: "user",
        position: pos, raw_score: pos, value_kind: "rank",
      });
    }

    expectRefusal(await link(s), "Placement Game");
    // Both results survive: nothing was resolved by deleting one.
    const { data: rows } = await ctx.admin.from("game_results").select("entity_id").eq("game_id", g);
    expect((rows ?? []).map((r) => r.entity_id).sort()).toEqual([s.ghostId, realId].sort());
  }, 60000);

  it("CONTROL: in DIFFERENT games, the link goes through and the placeholder's seat moves to the account", async () => {
    const s = await seedPair("control");
    const ghostGame = await game(s.secondTripId, "Ghost's Game");
    const realGame = await game(s.secondTripId, "Account's Game");
    const ghostSeat = genId("gp");
    await insertOrThrow("game_participants", { id: ghostSeat, game_id: ghostGame, user_id: s.ghostId });
    await insertOrThrow("game_participants", { id: genId("gp"), game_id: realGame, user_id: realId });

    expect(await link(s)).toBeNull();

    expect(await ghostExists(s.ghostId)).toBe(false);
    const { data: seat } = await ctx.admin.from("game_participants").select("user_id").eq("id", ghostSeat).single();
    expect(seat!.user_id).toBe(realId);
  }, 60000);
});

describe("the helpers are not exposed (CLAUDE.md #28)", () => {
  it("a signed-in client cannot ask which games a named person played", async () => {
    const r = await ctx.authedClient("member").rpc("_games_played_by", { p_user_id: realId });
    expect(r.error, "an authenticated caller reached _games_played_by").not.toBeNull();
    const r2 = await ctx.authedClient("member").rpc("_shared_game_names", { p_a: realId, p_b: realId });
    expect(r2.error, "an authenticated caller reached _shared_game_names").not.toBeNull();
  }, 60000);
});
