import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 180 — `away_score`, `home_score`, `status` on `pickem_slate_games`.
 *
 * ── Why a real write and not a literal check ──────────────────────────────
 *
 * CLAUDE.md counts a migration probe that asserted `IF 'lower' IN ('main',
 * 'lower', …)` — a check that would have passed with the migration absent
 * entirely, because it compared a literal to a literal. The only test of a
 * constraint that means anything is one that tries to violate it and is
 * refused, and tries to satisfy it and is admitted.
 *
 * So every case here INSERTS or UPDATES a real row.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let slateId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Pick'em Scores Trip");
  gameId = genId("slategame");
  /**
   * ASSERTED, not fired and forgotten. The first version of this seed used
   * `game_type_id: "pickem"` — the real value is `gtt_pickem` — so the insert
   * failed on a foreign key, silently, and every test below then UPDATEd zero
   * rows. Five assertions failed with messages about scores and constraints,
   * none of which was the problem: no row existed for a constraint to fire on.
   *
   * A seed whose error is never read reports a confident wrong answer about the
   * thing under test, so both inserts are checked here.
   */
  const game = await ctx.admin
    .from("games")
    .insert({ id: gameId, trip_id: tripId, game_type_id: "gtt_pickem", name: "Pick'em" });
  expect(game.error, "seed: games insert").toBeNull();

  slateId = genId("s");
  const slate = await ctx.admin.from("pickem_slate_games").insert({
    id: slateId,
    game_id: gameId,
    display_order: 0,
    away_team: "Alabama",
    home_team: "Georgia",
  });
  expect(slate.error, "seed: slate insert").toBeNull();
}, 60_000);

afterAll(async () => {
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

const set = (patch: Record<string, unknown>) =>
  ctx.admin.from("pickem_slate_games").update(patch).eq("id", slateId);

describe("the columns exist and hold a score", () => {
  it("admits a score and a status", async () => {
    const { error } = await set({ away_score: 17, home_score: 24, status: "final" });
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("pickem_slate_games")
      .select("away_score, home_score, status")
      .eq("id", slateId)
      .single();
    expect(data).toMatchObject({ away_score: 17, home_score: 24, status: "final" });
  });

  it("admits a scoreless game as 0-0, which is a SCORE and not an absence", async () => {
    /**
     * The pair that keeps `0` and `null` apart at the storage layer. A schema
     * that could not tell them apart would make the display's whole
     * absent-is-not-zero contract unenforceable from below.
     */
    const { error } = await set({ away_score: 0, home_score: 0 });
    expect(error).toBeNull();
    const { data } = await ctx.admin
      .from("pickem_slate_games")
      .select("away_score")
      .eq("id", slateId)
      .single();
    expect(data?.away_score).toBe(0);
  });

  it("admits HALF a score, because manual entry passes through that state", async () => {
    /**
     * The both-or-neither invariant is deliberately NOT a CHECK: a runner types
     * the away score first, and a constraint would refuse the first keystroke of
     * every score ever entered. The rule lives at the READ, where one number
     * renders as no score at all.
     *
     * Asserted so that "we just forgot the constraint" and "we decided against
     * it" are not the same-looking absence.
     */
    const { error } = await set({ away_score: 21, home_score: null });
    expect(error).toBeNull();
  });
});

describe("and they refuse what they are there to refuse", () => {
  it("REFUSES a negative score", async () => {
    const { error } = await set({ away_score: -1 });
    expect(error, "a negative score was admitted").not.toBeNull();
    expect(error?.message).toContain("pickem_slate_games_scores_nonneg");
  });

  it("REFUSES a status outside the three the app knows", async () => {
    /**
     * `finished` is the plausible typo — it is what a person would write and
     * what a provider mapping might emit unmapped. The column takes the app's
     * own vocabulary so an external API's naming cannot leak in.
     */
    const { error } = await set({ status: "finished" });
    expect(error, "an unknown status was admitted").not.toBeNull();
    expect(error?.message).toContain("pickem_slate_games_status_known");
  });

  it("still admits all three known statuses", async () => {
    // The other half: a constraint that refused everything would pass the two
    // tests above and break the feature.
    for (const status of ["scheduled", "in_progress", "final"] as const) {
      const { error } = await set({ status });
      expect(error, status).toBeNull();
    }
  });
});

describe("score and result are independent", () => {
  it("lets a game be final with no result recorded", async () => {
    /**
     * The normal state of a slate mid-weekend: the games have ended and the
     * runner has not yet said who covered. A schema that coupled them would
     * make the manual flow impossible — and coupling them is exactly the thing
     * the display must never do either, since the spread is hand-entered.
     */
    const { error } = await set({ status: "final", away_score: 31, home_score: 3, result: null });
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("pickem_slate_games")
      .select("status, away_score, result")
      .eq("id", slateId)
      .single();
    expect(data?.status).toBe("final");
    expect(data?.away_score).toBe(31);
    expect(data?.result).toBeNull();
  });
});
