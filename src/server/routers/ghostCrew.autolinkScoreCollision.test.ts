import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * #1024 — the owner auto-link REFUSES, readably, when the placeholder and the
 * account both hold a score for the same hole of the same game.
 *
 * Since migration 197 (#1481) this is one instance of a wider rule — refuse
 * whenever both are in the same game AT ALL — so the sentence names the game
 * rather than the hole. `ghostCrew.linkSameGame.test.ts` covers the rest.
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
let realId: string;
let realEmail: string;
const madeGames: string[] = [];

const UNIT = "7";

/**
 * EACH CASE BUILDS ITS OWN COLLISION (#1527). The four cases used to share one
 * placeholder and one game, and the last of them ("is not a blanket refusal")
 * deletes a score and performs the link — which MERGES the placeholder away.
 * Shuffled ahead of the others, it left the refusal case with no collision to
 * refuse ("expected [] to have a length of 1") and the DB-guard case linking a
 * placeholder that no longer existed (23514 where 23505 was expected).
 *
 * The account stays shared: no case changes anything about it that another
 * case reads, because each collision sits on its own two trips and its own game.
 */
type Collision = { tripId: string; ghostId: string; gameId: string };

async function seedCollision(label: string): Promise<Collision> {
  const tripId = await ctx.createTrip(`Collision link ${label}`);
  const ghost = (await ctx.caller().ghostCrew.create({ tripId, name: "Brad", role: "Member" })) as { id: string };

  // The second trip both identities are on, and the game where both scored.
  const otherTripId = await ctx.createTrip(`Shared second trip ${label}`);
  await ctx.addTripMemberById(otherTripId, realId, "Member");
  const tm = await ctx.admin.from("trip_members").insert({ trip_id: otherTripId, user_id: ghost.id, role: "Member", status: "in" });
  if (tm.error) throw new Error(`seed ghost membership: ${tm.error.message}`);

  const gameId = genId("game");
  const g = await ctx.admin.from("games").insert({
    id: gameId,
    trip_id: otherTripId,
    game_type_id: "gtt_stroke_play",
    name: "Collision Game",
    status: "active",
  });
  if (g.error) throw new Error(`seed game: ${g.error.message}`);
  madeGames.push(gameId);

  // Error-checked: an unchecked seed that silently wrote nothing would let the
  // link succeed and read as "no collision", which is the thing under test.
  for (const [participantId, value] of [[ghost.id, 5], [realId, 6]] as const) {
    const se = await ctx.admin.from("score_entries").insert({
      id: genId("se-collide"),
      game_id: gameId,
      participant_id: participantId,
      participant_type: "user",
      unit_label: UNIT,
      value,
      annotations: {},
      submitted_at: new Date().toISOString(),
    });
    if (se.error) throw new Error(`seed collision score: ${se.error.message}`);
  }
  return { tripId, ghostId: ghost.id, gameId };
}

async function scoresFor(gameId: string, participantId: string) {
  const { data, error } = await ctx.admin
    .from("score_entries")
    .select("id, value")
    .eq("game_id", gameId)
    .eq("participant_id", participantId)
    .eq("participant_type", "user")
    .eq("unit_label", UNIT);
  if (error) throw new Error(`read scores: ${error.message}`);
  return data ?? [];
}

/** Premise for every refusal: the collision is really there, or a refusal proves nothing. */
async function expectCollision(c: Collision) {
  expect((await scoresFor(c.gameId, c.ghostId)).map((r) => r.value)).toEqual([5]);
  expect((await scoresFor(c.gameId, realId)).map((r) => r.value)).toEqual([6]);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  // A throwaway account this file owns (#1481 follow-up): linking MERGES into
  // it and deletes rows, so it must not be the shared `outsider` other files use.
  const account = await ctx.createAccount("score-collision");
  realId = account.id;
  realEmail = account.email;
}, 60_000);

afterAll(async () => {
  if (madeGames.length) {
    await ctx.admin.from("score_entries").delete().in("game_id", madeGames);
    await ctx.admin.from("games").delete().in("id", madeGames);
  }
  await ctx?.cleanup();
}, 60_000);

describe("owner auto-link with a score collision (#1024)", () => {
  it("refuses with a CONFLICT that says what happened and what the owner can do", async () => {
    const c = await seedCollision("refuses");
    await expectCollision(c);

    let caught: unknown;
    try {
      await ctx.caller().ghostCrew.update({ tripId: c.tripId, guestUserId: c.ghostId, email: realEmail });
    } catch (e) {
      caught = e;
    }
    expect(caught, "the link went through — nothing refused the collision").toBeInstanceOf(TRPCError);
    const err = caught as TRPCError;

    // CONFLICT, not INTERNAL_SERVER_ERROR: this is a state the owner can
    // resolve, not a fault. Today's raw duplicate-key error arrives as a 500.
    expect(err.code).toBe("CONFLICT");
    // Asserted on OUR sentence. A Postgres constraint message cannot produce
    // "are both in <game name>", so this separates "the pre-check fired" from
    // "the unique index did".
    expect(err.message).toContain("are both in Collision Game");
    // …and it names a next step, not only the fault.
    expect(err.message).toMatch(/separate crew members/);
    // No wrapper prefix and no raw constraint text leaking through.
    expect(err.message).not.toMatch(/Failed to link|duplicate key|score_entries/);
  }, 60_000);

  it("changes nothing: both scores, the placeholder, and its membership are all still there", async () => {
    // It makes the refused attempt itself — it used to rely on the case above
    // having made it, and asserting "nothing changed" after no attempt at all
    // could not fail.
    const c = await seedCollision("changes-nothing");
    await expectCollision(c);
    await expect(
      ctx.caller().ghostCrew.update({ tripId: c.tripId, guestUserId: c.ghostId, email: realEmail })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expectCollision(c);

    const { data: ghostRow, error: ghostErr } = await ctx.admin.from("users").select("id").eq("id", c.ghostId).maybeSingle();
    if (ghostErr) throw new Error(`read ghost: ${ghostErr.message}`);
    expect(ghostRow?.id).toBe(c.ghostId);

    const { data: membership, error: memErr } = await ctx.admin
      .from("trip_members").select("user_id").eq("trip_id", c.tripId).eq("user_id", c.ghostId);
    if (memErr) throw new Error(`read membership: ${memErr.message}`);
    expect(membership).toHaveLength(1);
  }, 60_000);

  it("the DB guard holds on its own — a caller that skips the router still gets the sentence", async () => {
    const c = await seedCollision("db-guard");
    await expectCollision(c);
    const res = await ctx.authedClient("owner").rpc("link_guest_to_account", {
      p_trip_id: c.tripId, p_ghost_id: c.ghostId, p_real_id: realId,
    });
    expect(res.error).not.toBeNull();
    expect(res.error!.code).toBe("23505");
    expect(res.error!.message).toContain("are both in Collision Game");
  }, 60_000);

  it("is not a blanket refusal: without the collision, the same link goes through", async () => {
    const c = await seedCollision("no-collision");
    await expectCollision(c); // premise: the collision existed, so removing it is the only difference
    const del = await ctx.admin.from("score_entries").delete()
      .eq("game_id", c.gameId).eq("participant_id", realId).eq("unit_label", UNIT);
    if (del.error) throw new Error(`clear collision: ${del.error.message}`);
    expect(await scoresFor(c.gameId, realId)).toEqual([]);

    await ctx.caller().ghostCrew.update({ tripId: c.tripId, guestUserId: c.ghostId, email: realEmail });

    const { data: ghostRow, error } = await ctx.admin.from("users").select("id").eq("id", c.ghostId).maybeSingle();
    if (error) throw new Error(`read ghost: ${error.message}`);
    expect(ghostRow).toBeNull();
    // The placeholder's score moved to the account rather than being dropped.
    expect((await scoresFor(c.gameId, realId)).map((r) => r.value)).toEqual([5]);
  }, 60_000);
});
