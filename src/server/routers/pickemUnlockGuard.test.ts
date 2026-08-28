import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Picks cannot reopen once results are in (migration 165).
 *
 * ── What this closes ───────────────────────────────────────────────────────
 *
 * `set_pickem_phase('unlock')` had no results guard: it cleared
 * `picks_locked_at` on any game whose picks had ever opened, whatever had
 * happened since. So a runner could unlock a game with results on the board and
 * `_pickem_picks_open_state` would return true — picks writable again on a
 * contest whose outcome the picker had already watched.
 *
 * That is not a UI nicety. Re-picking a game you have seen is a free
 * correction scored as a prediction, and nothing anywhere refused it.
 *
 * ── The two halves, and why the negative case is the load-bearing one ──────
 *
 * A guard that refuses everything would pass "refuses with a result" and break
 * the ordinary reopen, which is what `unlock` exists for — a runner who locked
 * early and wants to let a straggler in. Both directions are asserted, and the
 * permissive case is the one a careless fix breaks.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let slateId: string;

describe("set_pickem_phase('unlock') — results close the door", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Unlock Trip");
    gameId = genId("unlockgame");
    const g = await ctx.admin.from("games").insert({
      id: gameId,
      trip_id: tripId,
      game_type_id: "gtt_pickem",
      name: "Unlock Pick'em",
    });
    expect(g.error).toBeNull();
    const cfg = await ctx.admin.from("pickem_games").insert({ game_id: gameId });
    expect(cfg.error).toBeNull();

    slateId = genId("sg");
    const sl = await ctx.admin.from("pickem_slate_games").insert({
      id: slateId,
      game_id: gameId,
      display_order: 0,
      away_team: "Alabama",
      home_team: "Georgia",
      multiplier: 1,
    });
    expect(sl.error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    await ctx.admin.from("games").delete().eq("id", gameId);
    await ctx.cleanup();
  }, 60_000);

  /** Opened three hours ago, hand-locked an hour ago, no deadline. */
  beforeEach(async () => {
    await ctx.admin
      .from("pickem_games")
      .update({
        picks_opened_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        picks_locked_at: new Date(Date.now() - 3_600_000).toISOString(),
        picks_deadline: null,
      })
      .eq("game_id", gameId);
    await ctx.admin.from("pickem_slate_games").update({ result: null }).eq("game_id", gameId);
  });

  const unlock = () =>
    ctx.authedClient("owner").rpc("set_pickem_phase", {
      p_game_id: gameId,
      p_action: "unlock",
    });

  const locked = async () => {
    const { data } = await ctx.admin
      .from("pickem_games")
      .select("picks_locked_at")
      .eq("game_id", gameId)
      .single();
    return data?.picks_locked_at != null;
  };

  it("REFUSES once a slate game has a result", async () => {
    const seed = await ctx.admin
      .from("pickem_slate_games")
      .update({ result: "home" })
      .eq("id", slateId);
    expect(seed.error).toBeNull();
    // Asserted, because a seed that silently failed would leave this passing
    // against a game with no results at all — the guard never exercised.
    const check = await ctx.admin
      .from("pickem_slate_games").select("result").eq("id", slateId).single();
    expect(check.data?.result).toBe("home");

    const { error } = await unlock();
    expect(error?.message ?? "").toContain("RESULTS_RECORDED");
    expect(await locked()).toBe(true);
  });

  it("names an action that EXISTS and works", async () => {
    // The refusal points at Reset scores. Migration 162 taught
    // `_reset_game_scoring` about `pickem_slate_games.result`, so that
    // instruction is followable — before 162 it would have been the exact lie
    // CLAUDE.md's refusal rule exists to prevent.
    await ctx.admin.from("pickem_slate_games").update({ result: "home" }).eq("id", slateId);
    const { error } = await unlock();
    expect(error?.message ?? "").toContain("Reset scores");

    const res = await ctx.caller().games.resetScoring({ tripId, gameId });
    expect(res.success).toBe(true);

    // ...and now the same call goes through.
    expect((await unlock()).error).toBeNull();
    expect(await locked()).toBe(false);
  });

  it("still ALLOWS the ordinary reopen with no results — the load-bearing case", async () => {
    // A guard that refused everything passes the case above and breaks what
    // unlock is for: a runner who locked early letting a straggler in.
    const { error } = await unlock();
    expect(error).toBeNull();
    expect(await locked()).toBe(false);
  });

  it("refuses on a FINISHED game even with no slate result", async () => {
    // `_pickem_has_results` has four arms and the slate is only one. A game
    // finalized without slate results is still a game that has produced
    // outcomes, and reopening its picks is wrong for the same reason.
    await ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId);
    const { error } = await unlock();
    expect(error?.message ?? "").toContain("RESULTS_RECORDED");
    expect(await locked()).toBe(true);
    await ctx.admin.from("games").update({ status: "pending" }).eq("id", gameId);
  });

  it("leaves LOCK and OPEN alone — the guard is on unlock only", async () => {
    await ctx.admin.from("pickem_slate_games").update({ result: "home" }).eq("id", slateId);
    // Locking an already-locked game is a no-op, not a refusal; opening is
    // idempotent on `picks_opened_at`. Neither reopens anything, so neither
    // needs the guard — and a guard that spread to them would break finalize.
    expect(
      (await ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "lock" }))
        .error
    ).toBeNull();
    expect(
      (await ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "open" }))
        .error
    ).toBeNull();
    expect(await locked()).toBe(true);
  });
});
