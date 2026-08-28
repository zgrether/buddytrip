import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `game_started` (migration 161) — one predicate, a branch per format.
 *
 * The board's five-way partition splits `active` into Ready-for-Play and
 * underway on this. Before the view it was two batch reads merged into a Set,
 * and the comment beside the second already named the shape: an outcome game
 * has no `score_entries` however many holes are decided, so it needed its own
 * source. Pick'em was the third, which is what turned an accident into a
 * pattern worth extracting.
 *
 * The test that must fail against a plausible wrong build: **one that never
 * checks `started` passes against a game stuck on "Ready for Play"** — so each
 * arm is asserted false BEFORE its source exists and true after, rather than
 * only after.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;

async function started(gameId: string): Promise<boolean> {
  const { data, error } = await ctx.admin.from("game_started").select("game_id").eq("game_id", gameId);
  if (error) throw new Error(`game_started: ${error.message}`);
  return (data ?? []).length > 0;
}

async function newGame(type: string, name: string): Promise<string> {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: type,
    name,
    competitionId,
  })) as { id: string };
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("game_started Trip");
  competitionId = await ctx.createCompetition(tripId, "game_started Cup");
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("game_started — every format contributes its own answer", () => {
  it("PICK'EM: false before the first result, true after — the arm that did not exist", async () => {
    // Without this arm a locked pick'em game reads Ready-for-Play indefinitely,
    // however many results are in.
    const gameId = await newGame("gtt_pickem", "Pickem started");
    await ctx.admin.from("pickem_games").upsert({ game_id: gameId });
    const sgId = genId("sg");
    await ctx.admin.from("pickem_slate_games").insert({
      id: sgId,
      game_id: gameId,
      display_order: 0,
      away_team: "Alabama",
      home_team: "Georgia",
      multiplier: 1,
    });

    // A slate with no results is NOT started — the before half, which is what
    // makes the after half mean something.
    expect(await started(gameId)).toBe(false);

    await ctx.admin.from("pickem_slate_games").update({ result: "away" }).eq("id", sgId);
    expect(await started(gameId)).toBe(true);

    // ...and clearing it puts the game back. The runner un-taps a mistake and
    // the board should stop calling the game underway.
    await ctx.admin.from("pickem_slate_games").update({ result: null }).eq("id", sgId);
    expect(await started(gameId)).toBe(false);

    await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  });

  it("PICK'EM: a PUSH counts — the game produced a fact", async () => {
    // A build that only recognised away/home would leave a slate of pushes
    // reading as not-started. Both zero-scoring outcomes are results.
    const gameId = await newGame("gtt_pickem", "Pickem push started");
    await ctx.admin.from("pickem_games").upsert({ game_id: gameId });
    const sgId = genId("sg");
    await ctx.admin.from("pickem_slate_games").insert({
      id: sgId,
      game_id: gameId,
      display_order: 0,
      away_team: "A",
      home_team: "B",
      multiplier: 1,
    });

    for (const r of ["push", "cancelled"] as const) {
      await ctx.admin.from("pickem_slate_games").update({ result: r }).eq("id", sgId);
      expect(await started(gameId), r).toBe(true);
    }

    await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  });

  it("GOLF: a score entry starts a game", async () => {
    const gameId = await newGame("gtt_stroke_play", "Stroke started");
    expect(await started(gameId)).toBe(false);

    const id = genId("se");
    const { error } = await ctx.admin.from("score_entries").insert({
      id,
      game_id: gameId,
      participant_type: "user",
      participant_id: ctx.user.id,
      unit_label: "1",
      value: 4,
      submitted_by: ctx.user.id,
    });
    expect(error).toBeNull();
    expect(await started(gameId)).toBe(true);

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  });

  it("OUTCOME MODE: a decided hole starts a game with ZERO score entries", async () => {
    // The instance the old inline comment described. A game here has no
    // score_entries at all, so a single-source predicate reads it as never
    // having begun.
    const gameId = await newGame("gtt_match_play", "Outcome started");
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matchId = genId("gm");
    await ctx.admin.from("game_matches").insert({
      id: matchId,
      game_id: gameId,
      match_number: 1,
      display_order: 0,
      side_a: { type: "user", id: ctx.user.id },
      side_b: { type: "user", id: ctx.getUser("member").id },
      status: "pending",
    });
    expect(await started(gameId)).toBe(false);

    const { error } = await ctx.admin.from("match_hole_outcomes").insert({
      id: genId("mho"),
      game_id: gameId,
      match_id: matchId,
      hole_number: 1,
      // `side_a`, not `a_win`. `match_hole_outcomes` and `game_matches` hold
      // the same concept under different vocabularies — one CHECKs
      // side_a/side_b/halved, the other a_win/b_win/halve — and using the wrong
      // one is refused by the constraint rather than stored wrong, which is the
      // good outcome of an otherwise avoidable split.
      result: "side_a",
      submitted_by: ctx.user.id,
    });
    expect(error).toBeNull();

    // No score entries whatsoever, and still started.
    const { data: entries } = await ctx.admin
      .from("score_entries")
      .select("id")
      .eq("game_id", gameId);
    expect(entries ?? []).toHaveLength(0);
    expect(await started(gameId)).toBe(true);

    await ctx.admin.from("match_hole_outcomes").delete().eq("game_id", gameId);
    await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  });

  it("a configured but unplayed game is NOT started", async () => {
    // The whole point of the split: Ready-for-Play is `active & !started`, so a
    // predicate that answered true for any configured game would collapse the
    // board's two sections into one.
    const gameId = await newGame("gtt_stroke_play", "Configured only");
    await ctx.admin.from("games").update({ status: "active" }).eq("id", gameId);
    await ctx.admin.from("game_participants").insert({
      id: genId("gp"),
      game_id: gameId,
      user_id: ctx.user.id,
      play_group_id: null,
      team_id: null,
    });
    expect(await started(gameId)).toBe(false);

    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  });
});
