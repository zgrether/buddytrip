import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Solo stroke play (#954/#955) — the player-count floor never had a reason.
 *
 * #954 traced it to COMPETITION_ENGINE.md:88-89, a sentence describing
 * play_group as "the foursome / physical card (2-4 players)" whose lower bound
 * got encoded as a validation range on two client setup screens. The server
 * never enforced it: `playGroups.setFoursomes` has always accepted a group of
 * one (`min(1)`), and this is the procedure the fixed client path actually
 * calls (`StrokeGameView.start()` → `playGroups.setFoursomes`) — NOT
 * `games.addParticipants`, which keeps its own unrelated `min(2)` untouched
 * (used elsewhere for a batch add of INDIVIDUAL, non-grouped participants; it
 * cannot seed a solo game and was never in the path this fix touches).
 *
 * #954 T0.5 found by reading, not running, that nothing breaks at n=1: the
 * finalize QUALIFICATION gate (`requireQualified`, `server/lib/strokePlay.ts`)
 * exists for an unrelated reason — stopping an unscored player from ranking
 * first — and happens to make a solo standings row correct as a side effect.
 * No code is actually aware it is supporting a solo game. That is exactly the
 * kind of correctness that silently breaks when `requireQualified` is later
 * changed for its real purpose, which is what this file pins: the REAL
 * `games.finish` dispatch, not the pure function in isolation
 * (`strokePlay.test.ts` already covers `computeStrokePlayStandings` at n=1 as
 * a unit; this is the integration the unit test cannot reach).
 *
 * Round count and player count are independent axes (#954 checked 9-hole
 * composition) — both an 18-hole and a 9-hole solo round are pinned here.
 */

const STROKE_PLAY = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;

describe("solo stroke play reaches a correct, non-degenerate result", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Solo Stroke Play Trip");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("18 holes, one player: create → group → score → finish → position 1, no PRECONDITION_FAILED", async () => {
    const owner = ctx.getUser("owner").id;

    const game = (await ctx.caller().games.create({
      tripId,
      gameTypeId: STROKE_PLAY,
      name: "Solo 18",
    })) as { id: string };

    // The exact call the fixed StrokeGameView.start() makes: ONE group, ONE
    // user. This both seeds game_participants and satisfies migration 089's
    // go-live requirement (participants must be in a playing group) — the
    // path a solo round actually takes, not a synthetic seed.
    await ctx.caller().playGroups.setFoursomes({
      tripId,
      gameId: game.id,
      groups: [{ name: "Group 1", userIds: [owner] }],
    });
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    // Bogey every hole (par 4 default → 5) so the total is easy to hand-check:
    // 18 * 5 = 90. One player, so upsertEntry per hole is cheap (unlike the
    // 4-player team test, which bulk-inserts for that reason).
    for (let hole = 1; hole <= 18; hole++) {
      await ctx.caller().scores.upsertEntry({
        tripId, gameId: game.id, participantId: owner, participantType: "user",
        unitLabel: String(hole), value: 5,
      });
    }

    // Does not throw PRECONDITION_FAILED ("No player has completed...") — the
    // one failure mode #954 T0.5 identified as the real risk at n=1.
    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: game_ } = await ctx.admin.from("games").select("status").eq("id", game.id).single();
    expect(game_?.status).toBe("complete");

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score, position")
      .eq("game_id", game.id);

    // Exactly one row — not zero (the empty-standings failure mode), not
    // duplicated, and ranked 1st because nothing else exists to rank below.
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      entity_id: owner,
      entity_type: "user",
      raw_score: 90,
      position: 1,
    });
  }, 60_000);

  it("9 holes, one player: round length and player count are independent axes", async () => {
    const owner = ctx.getUser("owner").id;

    const game = (await ctx.caller().games.create({
      tripId,
      gameTypeId: STROKE_PLAY,
      name: "Solo 9",
    })) as { id: string };

    // Cheapest path to a real 9-hole schema: a direct scorecard_schema write
    // (same technique as matches.test.ts's 9-hole case) rather than creating a
    // course. `unitsFromSchema` needs BOTH `labels` and `metadata.par` present
    // to leave its 18-hole fallback — `count` alone (which is enough for the
    // match-play reader) is not.
    const labels = Array.from({ length: 9 }, (_, i) => String(i + 1));
    const par = [4, 5, 3, 4, 4, 3, 5, 4, 4];
    await ctx.admin
      .from("games")
      .update({ scorecard_schema: { units: { count: 9, labels, metadata: { par } } } })
      .eq("id", game.id);

    await ctx.caller().playGroups.setFoursomes({
      tripId,
      gameId: game.id,
      groups: [{ name: "Group 1", userIds: [owner] }],
    });
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });

    // Par every hole: 9 * sum(par) = 9 holes, total strokes = sum(par) = 36.
    for (let hole = 1; hole <= 9; hole++) {
      await ctx.caller().scores.upsertEntry({
        tripId, gameId: game.id, participantId: owner, participantType: "user",
        unitLabel: String(hole), value: par[hole - 1],
      });
    }

    await ctx.caller().games.finish({ tripId, gameId: game.id });

    const { data: rows } = await ctx.admin
      .from("game_results")
      .select("entity_id, raw_score, position")
      .eq("game_id", game.id)
      .eq("entity_type", "user");

    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ entity_id: owner, raw_score: 36, position: 1 });
  }, 60_000);
});
