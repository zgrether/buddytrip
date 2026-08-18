import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * A reset never leaves the go-live triple half-moved (#895, CLAUDE.md #25).
 *
 * `status`, `scoring_enabled` and `pairings_published_at` are one fact stored in three
 * columns. Going live writes all three together; nothing in the type system enforces
 * that, and `_reset_game_scoring` used to write `status` alone — leaving a reset game
 * `pending` beside `scoring_enabled = true`. `matches.listByGame` reads two of the three
 * a few lines apart (the access gate on `status`, the `published` flag on
 * `pairings_published_at`), so members saw an empty match list on a game that still
 * looked live to staff, and nobody got an error.
 *
 * ── Why this test has to BUILD the broken state ─────────────────────────────
 * No production game is in the split state — all 23 sit in three internally-coherent
 * groups. That makes the fix safe to ship, and it also means there is no live instance
 * to point at. A test written by looking for the bug would find nothing and pass.
 *
 * So these MANUFACTURE the precondition: switch a game on the way go-live does, play it,
 * finish it, then reset. That is the easy step to skip when a bug cannot be reproduced
 * in production, and skipping it is how a fix ships unverified.
 *
 * The assertion is the INVARIANT, not the three values — `coherent()` rejects any state
 * where the columns disagree, so it fails on a half-move in either direction rather than
 * only the one direction #895 happened to report.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;

type Triple = { status: string; scoring_enabled: boolean; published: boolean };

/**
 * The invariant itself: enabled ⟺ published ⟺ not-pending. Deliberately expressed as a
 * relationship rather than as expected literals — a test asserting `status === 'active'`
 * would pass on a game whose OTHER two columns had drifted.
 */
function coherent(t: Triple): boolean {
  return t.scoring_enabled === t.published && t.scoring_enabled === (t.status !== "pending");
}

const ck = async <T extends { error: { message: string } | null }>(label: string, p: PromiseLike<T>): Promise<T> => {
  const r = await p;
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r;
};

async function triple(gameId: string): Promise<Triple> {
  const { data, error } = await ctx.admin
    .from("games").select("status, scoring_enabled, pairings_published_at").eq("id", gameId).single();
  if (error) throw new Error(`read triple: ${error.message}`);
  const g = data as Record<string, unknown>;
  return {
    status: g.status as string,
    scoring_enabled: g.scoring_enabled as boolean,
    published: g.pairings_published_at != null,
  };
}

async function addGame(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await ck("game", ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId,
    game_type_id: "gtt_match_play", name, points_total: 4, status: "pending",
  }));
  return id;
}

/** Switch a game on exactly the way go-live does — all three columns, one statement. */
async function goLive(gameId: string) {
  await ck("go live", ctx.admin.from("games").update({
    scoring_enabled: true, status: "active", pairings_published_at: new Date().toISOString(),
  }).eq("id", gameId));
}

/** Play and finish it, so the reset has something to clear and `status` is 'complete'. */
async function playAndFinish(gameId: string) {
  await ck("score", ctx.admin.from("score_entries").insert({
    id: crypto.randomUUID(), game_id: gameId, participant_id: ctx.user.id,
    participant_type: "user", unit_label: "1", value: 4, submitted_by: ctx.user.id,
  }));
  await ck("result", ctx.admin.from("game_results").insert({
    id: crypto.randomUUID(), game_id: gameId, entity_type: "user", entity_id: ctx.user.id, position: 1,
  }));
  await ck("finish", ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId));
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Go-Live Triple");
  competitionId = await ctx.createCompetition(tripId, "Triple Cup");
}, 60_000);

afterAll(async () => { await ctx?.cleanup(); });

describe("reset keeps the go-live triple together (#895)", () => {
  it("a scores reset on a LIVE, played game leaves all three agreeing", async () => {
    const game = await addGame("Live Match");
    await goLive(game);
    await playAndFinish(game);
    expect(await triple(game)).toMatchObject({ status: "complete", scoring_enabled: true, published: true });

    const { error } = await ctx.admin.rpc("_reset_game_scoring", { p_game_id: game });
    expect(error, `reset failed: ${error?.message}`).toBeNull();

    const after = await triple(game);
    expect(
      coherent(after),
      `Split go-live state after a scores reset: ${JSON.stringify(after)}. The access gate ` +
        "in matches.listByGame keys on status while the `published` flag keys on " +
        "pairings_published_at, so a half-move hides a live game's matches from members " +
        "with no error anywhere (#895 / CLAUDE.md #25).",
    ).toBe(true);
    // Ready = switched on, nothing played. The game stays enabled and announced.
    expect(after).toMatchObject({ status: "active", scoring_enabled: true, published: true });

    const { count } = await ctx.admin
      .from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", game);
    expect(count, "the reset must still clear the scores").toBe(0);
  }, 60_000);

  it("a scores reset on a game that was never switched on leaves it pending", async () => {
    const game = await addGame("Never Live");
    const { error } = await ctx.admin.rpc("_reset_game_scoring", { p_game_id: game });
    expect(error, `reset failed: ${error?.message}`).toBeNull();

    const after = await triple(game);
    expect(coherent(after), `Split state: ${JSON.stringify(after)}`).toBe(true);
    expect(after).toMatchObject({ status: "pending", scoring_enabled: false, published: false });
  }, 60_000);

  it("a SKELETON reset switches the game off — all three, not just scoring_enabled", async () => {
    // The regression the level-1 fix could have introduced: level 2 used to inherit
    // `status='pending'` from level 1, which no longer forces it.
    const game = await addGame("Skeleton Match");
    await goLive(game);
    await playAndFinish(game);

    const { error } = await ctx.admin.rpc("_reset_game_to_skeleton", { p_game_id: game });
    expect(error, `reset failed: ${error?.message}`).toBeNull();

    const after = await triple(game);
    expect(
      coherent(after),
      `Split go-live state after a skeleton reset: ${JSON.stringify(after)} — the same ` +
        "bug pointing the other way (switched off but still 'active').",
    ).toBe(true);
    expect(after).toMatchObject({ status: "pending", scoring_enabled: false, published: false });
  }, 60_000);

  it("the COMPETITION-wide reset leaves every game coherent, not just one", async () => {
    // The path that matters more than the per-game Danger Zone: one Owner action loops
    // `_reset_game_scoring` over every game in the competition, so the pre-fix bug put
    // all of them into the split state at once. `reset_competition_scoring` has no
    // status handling of its own (verified against pg_get_functiondef), so this asserts
    // the inner fix actually reaches the outer path.
    const a = await addGame("Comp Game A");
    const b = await addGame("Comp Game B");
    await goLive(a); await playAndFinish(a);
    await goLive(b); await playAndFinish(b);
    const c = await addGame("Comp Game C");   // never switched on

    // Through the OWNER's caller, not ctx.admin: unlike the per-game cores, there is no
    // `_reset_competition_scoring` — `reset_competition_scoring` IS the wrapper and
    // carries `assert_competition_owner`, which refuses a service-role caller (no
    // auth.uid()). Worth knowing: the per-game and competition-wide primitives are not
    // the same shape.
    await ctx.caller().competitions.resetScoring({ tripId, competitionId });

    for (const [label, id] of [["A", a], ["B", b], ["C", c]] as const) {
      const t = await triple(id);
      expect(coherent(t), `game ${label} left split: ${JSON.stringify(t)}`).toBe(true);
    }
    expect(await triple(a)).toMatchObject({ status: "active", scoring_enabled: true });
    expect(await triple(c)).toMatchObject({ status: "pending", scoring_enabled: false });
  }, 60_000);
});
