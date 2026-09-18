import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * #1024 — the owner auto-link REFUSES, readably, when the placeholder and the
 * account both hold a score for the same hole of the same game.
 *
 * `merge_guest_to_real_user` moves score rows with a plain UPDATE, and
 * `score_entries` is UNIQUE (game_id, participant_id, unit_label). Two
 * identities with a score on one hole therefore raise a raw duplicate-key error
 * inside the merge. The invite claim (migration 141) has refused this case with
 * a sentence since it shipped; `link_guest_to_account` did not, so the same
 * collision reached the owner as "Failed to link existing account: duplicate
 * key value violates unique constraint …" wrapped in a 500.
 *
 * REFUSE, NOT PICK A WINNER. Two scores for one hole are two records of a round
 * someone played. Which to keep is a person's call — deleting the loser inside
 * the function would be the function guessing. So the merge itself is not
 * touched (migration 190 changes only the wrapper).
 *
 * THE SHAPE SEEDED. The router refuses an account that is already on THIS trip,
 * so through the real caller the collision can only sit on ANOTHER trip the two
 * identities share — the merge is global. That is what this seeds.
 */

let ctx: TestContext;
let tripId: string;
let otherTripId: string;
let otherGameId: string;
let ghostId: string;
let realId: string;
let realEmail: string;

const UNIT = "7";

async function scoresFor(participantId: string) {
  const { data, error } = await ctx.admin
    .from("score_entries")
    .select("id, value")
    .eq("game_id", otherGameId)
    .eq("participant_id", participantId)
    .eq("participant_type", "user")
    .eq("unit_label", UNIT);
  expect(error).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  ctx = await TestContext.create();
  realId = ctx.getUser("outsider").id;
  realEmail = ctx.getUser("outsider").email;

  tripId = await ctx.createTrip("Collision link trip");
  const ghost = (await ctx.caller().ghostCrew.create({ tripId, name: "Brad", role: "Member" })) as { id: string };
  ghostId = ghost.id;

  // The second trip both identities are on, and the game where both scored.
  otherTripId = await ctx.createTrip("Shared second trip");
  await ctx.addTripMemberById(otherTripId, realId, "Member");
  const tm = await ctx.admin.from("trip_members").insert({ trip_id: otherTripId, user_id: ghostId, role: "Member", status: "in" });
  if (tm.error) throw new Error(`seed ghost membership: ${tm.error.message}`);

  otherGameId = genId("game");
  const g = await ctx.admin.from("games").insert({
    id: otherGameId,
    trip_id: otherTripId,
    game_type_id: "gtt_stroke_play",
    name: "Collision Game",
    status: "active",
  });
  if (g.error) throw new Error(`seed game: ${g.error.message}`);

  // Error-checked: an unchecked seed that silently wrote nothing would let the
  // link succeed and read as "no collision", which is the thing under test.
  for (const [participantId, value] of [[ghostId, 5], [realId, 6]] as const) {
    const se = await ctx.admin.from("score_entries").insert({
      id: genId("se-collide"),
      game_id: otherGameId,
      participant_id: participantId,
      participant_type: "user",
      unit_label: UNIT,
      value,
      annotations: {},
      submitted_at: new Date().toISOString(),
    });
    if (se.error) throw new Error(`seed collision score: ${se.error.message}`);
  }
}, 60_000);

afterAll(async () => {
  await ctx.admin.from("score_entries").delete().eq("game_id", otherGameId);
  await ctx.admin.from("games").delete().eq("id", otherGameId);
  await ctx?.cleanup();
}, 60_000);

describe("owner auto-link with a score collision (#1024)", () => {
  it("refuses with a CONFLICT that says what happened and what the owner can do", async () => {
    // Premise: the collision is really there, or the refusal below proves nothing.
    expect(await scoresFor(ghostId)).toHaveLength(1);
    expect(await scoresFor(realId)).toHaveLength(1);

    let caught: unknown;
    try {
      await ctx.caller().ghostCrew.update({ tripId, guestUserId: ghostId, email: realEmail });
    } catch (e) {
      caught = e;
    }
    expect(caught, "the link went through — nothing refused the collision").toBeInstanceOf(TRPCError);
    const err = caught as TRPCError;

    // CONFLICT, not INTERNAL_SERVER_ERROR: this is a state the owner can
    // resolve, not a fault. Today's raw duplicate-key error arrives as a 500.
    expect(err.code).toBe("CONFLICT");
    // Asserted on OUR sentence. A Postgres constraint message cannot produce
    // "a score for the same hole", so this separates "the pre-check fired" from
    // "the unique index did".
    expect(err.message).toMatch(/both have a score for the same hole/);
    // …and it names a next step, not only the fault.
    expect(err.message).toMatch(/separate crew members/);
    // No wrapper prefix and no raw constraint text leaking through.
    expect(err.message).not.toMatch(/Failed to link|duplicate key|score_entries/);
  }, 60_000);

  it("changes nothing: both scores, the placeholder, and its membership are all still there", async () => {
    const ghostScores = await scoresFor(ghostId);
    const realScores = await scoresFor(realId);
    expect(ghostScores.map((r) => r.value)).toEqual([5]);
    expect(realScores.map((r) => r.value)).toEqual([6]);

    const { data: ghostRow } = await ctx.admin.from("users").select("id").eq("id", ghostId).maybeSingle();
    expect(ghostRow?.id).toBe(ghostId);

    const { data: membership } = await ctx.admin
      .from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", ghostId);
    expect(membership ?? []).toHaveLength(1);
  }, 60_000);

  it("the DB guard holds on its own — a caller that skips the router still gets the sentence", async () => {
    const res = await ctx.authedClient("owner").rpc("link_guest_to_account", {
      p_trip_id: tripId, p_ghost_id: ghostId, p_real_id: realId,
    });
    expect(res.error).not.toBeNull();
    expect(res.error!.code).toBe("23505");
    expect(res.error!.message).toMatch(/both have a score for the same hole/);
  }, 60_000);

  it("is not a blanket refusal: without the collision, the same link goes through", async () => {
    await ctx.admin.from("score_entries").delete()
      .eq("game_id", otherGameId).eq("participant_id", realId).eq("unit_label", UNIT);

    await ctx.caller().ghostCrew.update({ tripId, guestUserId: ghostId, email: realEmail });

    const { data: ghostRow } = await ctx.admin.from("users").select("id").eq("id", ghostId).maybeSingle();
    expect(ghostRow).toBeNull();
    // The placeholder's score moved to the account rather than being dropped.
    expect((await scoresFor(realId)).map((r) => r.value)).toEqual([5]);
  }, 60_000);
});
