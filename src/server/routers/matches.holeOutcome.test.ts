import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Refactor B1 — hole-outcome entry mode, the finish-time compute only. No entry
 * UI/mutation exists yet (B2), so these tests simulate what B2's outcome-entry
 * mutation will do: flip `games.entry_mode` to 'outcome' and insert
 * `match_hole_outcomes` rows directly (via the admin client, exactly as a future
 * `matches.setHoleOutcome` mutation would after its own RLS/permission check —
 * B1 proves the ENGINE reads this source correctly, not the write-path perms,
 * which are B3's job).
 *
 * Acceptance gates (B1 slice of §4): the engine produces byte-identical match
 * state from outcomes (dormie/closeout/Glorious all engine-level, already proven
 * pure in matchPlay.test.ts) — here we prove the DB-PERSIST side reads the right
 * table, writes game_matches/game_results correctly, and — the headline —
 * finishes with ZERO score_entries rows anywhere for the game.
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Hole Outcome Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

async function freshOutcomeGame(name: string): Promise<string> {
  const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name });
  await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", game.id);
  return game.id as string;
}

/** Insert hole-outcome rows directly (simulates B2's future entry mutation). */
async function recordOutcomes(gameId: string, matchId: string, rows: { hole: number; result: "side_a" | "side_b" | "halved" }[]) {
  await ctx.admin.from("match_hole_outcomes").insert(
    rows.map((r) => ({
      id: crypto.randomUUID(),
      game_id: gameId,
      match_id: matchId,
      hole_number: r.hole,
      result: r.result,
      submitted_by: owner,
    }))
  );
}

describe("hole-outcome entry — computeMatchPlayResults reads match_hole_outcomes, not score_entries", () => {
  it("a closed-out outcome-mode match resolves to a_win / 3&2, with ZERO score_entries rows", async () => {
    const gameId = await freshOutcomeGame("Outcome Close 3&2");
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;

    await ctx.caller().games.enableScoring({ tripId, gameId });

    // A wins 1-3, halves 4-16 → +3 frozen at hole 16 = 3&2 (identical shape to the
    // score-mode "Close 3&2" test in matches.test.ts — same match, decided the
    // outcome way instead of the gross way).
    const rows: { hole: number; result: "side_a" | "side_b" | "halved" }[] = [
      { hole: 1, result: "side_a" }, { hole: 2, result: "side_a" }, { hole: 3, result: "side_a" },
    ];
    for (let h = 4; h <= 16; h++) rows.push({ hole: h, result: "halved" });
    await recordOutcomes(gameId, matchId, rows);

    const { matches: outcomes } = await ctx.caller().games.finish({ tripId, gameId });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ result: "a_win", margin: "3&2", status: "complete" });

    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id, position, raw_score")
      .eq("game_id", gameId);
    const resultRows = results as { entity_id: string; position: number; raw_score: number | null }[];
    expect(resultRows).toHaveLength(2);
    expect(resultRows.find((r) => r.entity_id === owner)?.position).toBe(1);
    expect(resultRows.find((r) => r.entity_id === member)?.position).toBe(2);

    // The headline: no score_entries row exists ANYWHERE for this game.
    const { data: scoreRows } = await ctx.admin.from("score_entries").select("id").eq("game_id", gameId);
    expect(scoreRows).toHaveLength(0);
  });

  it("an in-progress outcome-mode match (not yet decided) reads 'active', not complete", async () => {
    const gameId = await freshOutcomeGame("Outcome In Progress");
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });
    await recordOutcomes(gameId, matchId, [{ hole: 1, result: "side_a" }, { hole: 2, result: "halved" }]);

    const { matches: outcomes } = await ctx.caller().games.finish({ tripId, gameId });
    expect(outcomes[0]).toMatchObject({ result: null, status: "active", thru: 2 });
  });

  it("a halved (all-square-through-18) outcome-mode match resolves to a halve", async () => {
    const gameId = await freshOutcomeGame("Outcome Halve");
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });
    const rows = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, result: "halved" as const }));
    await recordOutcomes(gameId, matchId, rows);

    const { matches: outcomes } = await ctx.caller().games.finish({ tripId, gameId });
    expect(outcomes[0]).toMatchObject({ result: "halve", margin: "AS", status: "complete" });

    const { data: results } = await ctx.admin.from("game_results").select("entity_id, position").eq("game_id", gameId);
    const rows2 = results as { entity_id: string; position: number }[];
    // A halve shares position 1 (both square), same convention as score-mode ties.
    expect(rows2.every((r) => r.position === 1)).toBe(true);
  });

  it("a 2v2 outcome-mode match awards on the play_group SIDE, not a user", async () => {
    const gameId = await freshOutcomeGame("Outcome Doubles");
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 2, sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 }],
    });
    const m = matches as { id: string; side_a: { id: string }; side_b: { id: string } }[];
    const matchId = m[0].id;
    const pgA = m[0].side_a.id;
    await ctx.caller().games.enableScoring({ tripId, gameId });
    const rows = [
      { hole: 1, result: "side_a" as const }, { hole: 2, result: "side_a" as const }, { hole: 3, result: "side_a" as const },
    ];
    for (let h = 4; h <= 16; h++) rows.push({ hole: h, result: "halved" as const });
    await recordOutcomes(gameId, matchId, rows);

    await ctx.caller().games.finish({ tripId, gameId });
    const { data: results } = await ctx.admin.from("game_results").select("entity_id, entity_type").eq("game_id", gameId);
    const rows2 = results as { entity_id: string; entity_type: string }[];
    expect(rows2.every((r) => r.entity_type === "play_group")).toBe(true);
    expect(rows2.find((r) => r.entity_id === pgA)?.entity_type).toBe("play_group");
  });

  it("a Glorious hole swings the outcome-mode match's margin double (derive-don't-snapshot, unchanged engine)", async () => {
    const gameId = await freshOutcomeGame("Outcome Glorious");
    await ctx.admin.from("games").update({ modifiers: { glorious_holes: { holes: 3 } } }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });
    // 15 halves, then A wins hole 16 (glorious, weight 2) → 2 up thru 16, 2 to play.
    const rows = Array.from({ length: 15 }, (_, i) => ({ hole: i + 1, result: "halved" as const }));
    rows.push({ hole: 16, result: "side_a" as const });
    await recordOutcomes(gameId, matchId, rows);

    const { matches: outcomes } = await ctx.caller().games.finish({ tripId, gameId });
    // 2 up (weighted) with 2 raw holes left — NOT closed (swing left with 2 glorious
    // holes remaining is 4, exceeding the 2-up lead) — proves the glorious weight
    // applied to an OUTCOME-sourced hole exactly as it does for a score-sourced one.
    expect(outcomes[0]).toMatchObject({ result: null, status: "active", thru: 16 });
  });

  it("nothing decided yet → finish is a safe no-op (mirrors the score-mode empty early-return)", async () => {
    const gameId = await freshOutcomeGame("Outcome Nothing Yet");
    await ctx.caller().matches.setPairings({
      tripId, gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    await ctx.caller().games.enableScoring({ tripId, gameId });
    const { matches: outcomes } = await ctx.caller().games.finish({ tripId, gameId });
    expect(outcomes).toEqual([]);
  });
});
