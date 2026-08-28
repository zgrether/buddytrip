import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * `_pickem_has_results` (SQL) vs `pickem.get`'s `hasResults` (TypeScript).
 *
 * ── Why there are two, and why that is permanent ───────────────────────────
 *
 * The SQL function is the AUTHORITY: it is what `save_game_config` and
 * `save_pickem_config` actually refuse on (migration 157). It answers about a
 * CONTAINER rather than about its caller, so per CLAUDE.md #28 it is REVOKEd
 * from `authenticated` and the router cannot call it. SQL cannot import
 * TypeScript, so `pickem.get` mirrors it — exactly as `pickemLifecycle.ts`
 * mirrors `pickem_picks_open`, and this file is the same instrument
 * `pickemLifecycleParity.rls.test.ts` is.
 *
 * ── What a mismatch would look like, which is why it needs a test ──────────
 *
 * Nothing errors. The settings page offers a row the RPC then refuses
 * (`PICKEM_SCORED` out of nowhere on Save), or hides a row that was still
 * editable. Both read as a caching bug and neither points at a predicate.
 *
 * Change either side and this fails, which is the point.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;

/** The SQL authority, read through the service client — the function is
 *  REVOKEd from `authenticated`, which is the whole reason the mirror exists. */
async function sqlSaysHasResults(): Promise<boolean> {
  const { data, error } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: gameId });
  if (error) throw new Error("_pickem_has_results: " + error.message);
  return data as boolean;
}

/** The TypeScript mirror, read the way the client actually gets it. */
async function routerSaysHasResults(): Promise<boolean> {
  const res = (await ctx.caller().pickem.get({ tripId, gameId })) as { hasResults: boolean };
  return res.hasResults;
}

/** Assert the two AGREE, and say what they agreed on — a test that only
 *  compared them would pass if both were stuck on false forever. */
async function bothSay(expected: boolean, label: string) {
  const sql = await sqlSaysHasResults();
  const ts = await routerSaysHasResults();
  expect(sql, `${label}: SQL`).toBe(expected);
  expect(ts, `${label}: router`).toBe(expected);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("hasResults parity Trip");
  competitionId = await ctx.createCompetition(tripId, "hasResults parity Cup");
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Parity pick'em",
    competitionId,
  })) as { id: string };
  gameId = g.id;
  await ctx.admin.from("pickem_games").upsert({ game_id: gameId });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("_pickem_has_results — SQL and the router mirror agree", () => {
  it("a fresh game: nothing scored", async () => {
    await bothSay(false, "fresh");
  });

  it("a game_results row makes it true", async () => {
    await ctx.admin.from("game_results").insert({
      id: `gr-parity-${gameId}`,
      game_id: gameId,
      entity_type: "user",
      entity_id: ctx.getUser("owner").id,
      raw_score: 1,
      position: 1,
    });
    await bothSay(true, "game_results");
    await ctx.admin.from("game_results").delete().eq("game_id", gameId);
    await bothSay(false, "game_results removed");
  });

  it("a DECIDED match makes it true — the outcome-mode path with no game_results", async () => {
    // The case a `game_results`-only check would miss, and the reason both
    // sides read `game_matches` too. `result` is CHECK-constrained to
    // a_win/b_win/halve, so this exercises a real value rather than a
    // placeholder the constraint would have refused.
    await ctx.admin.from("game_matches").insert({
      id: `gm-parity-${gameId}`,
      game_id: gameId,
      match_number: 1,
      display_order: 0,
      side_a: { type: "user", id: ctx.getUser("owner").id },
      side_b: { type: "user", id: ctx.getUser("member").id },
      status: "pending",
    });
    await bothSay(false, "match present but undecided");

    await ctx.admin.from("game_matches").update({ result: "a_win" }).eq("game_id", gameId);
    await bothSay(true, "match decided");

    await ctx.admin.from("game_matches").update({ result: null }).eq("game_id", gameId);
    await bothSay(false, "result cleared");
  });

  it("a match marked complete counts even with a null result", async () => {
    await ctx.admin.from("game_matches").update({ status: "complete" }).eq("game_id", gameId);
    await bothSay(true, "match complete");
    await ctx.admin.from("game_matches").update({ status: "pending" }).eq("game_id", gameId);
    await bothSay(false, "match back to pending");
  });

  it("a FINISHED game counts, whatever its matches say", async () => {
    await ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId);
    await bothSay(true, "game complete");
    await ctx.admin.from("games").update({ status: "pending" }).eq("id", gameId);
    await bothSay(false, "game back to pending");
  });

  it("the SQL side is scoped to pick'em, and the mirror is only ever asked about pick'em", async () => {
    // The bug caught during 157: unscoped, the freeze in `save_game_config`
    // applied to every format and a finalized match-play game could no longer
    // have its points edited.
    const other = (await ctx.caller().games.create({
      tripId,
      gameTypeId: "gtt_generic_card",
      name: "Not pick'em",
      competitionId,
    })) as { id: string };
    await ctx.admin.from("games").update({ status: "complete" }).eq("id", other.id);

    const { data } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: other.id });
    expect(data).toBe(false);
  });
});
