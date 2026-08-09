import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * What happens when "Save scoring changes" is tapped on a game that is NOT in
 * correction mode.
 *
 * That combination should be impossible — `gameLifecycle` only offers the
 * re-lock CTA when `corrections_open` is true — but it is reachable for a moment
 * after a save, while the panel is rendering a stale cached lock state
 * (measured at ~390 ms over a 150 ms-RTT link). The button is live during that
 * window, so this is the path a fast double-tap takes, and it was untested.
 *
 * The answer this file pins: `games.finish` on an already-locked game is
 * IDEMPOTENT — it recomputes the same result from the same rows and re-writes
 * the same values. That is what makes the stale-CTA window a cosmetic bug rather
 * than a data one, and it is worth a test rather than an argument, because the
 * `finish` path deletes and re-inserts `game_results` (`write_game_results`) —
 * "it recomputes the same thing" is a claim about a destructive-then-restorative
 * sequence, which is exactly the kind of claim that stops being true quietly.
 *
 * NOTE this is idempotence of the WRITE, not a licence to call it: the redundant
 * call still costs a full re-derive and re-write. The fix for the window is in
 * the client (the lock state should not be wrong, and should not be rendered as
 * definite while unknown); this only bounds the damage if it is tapped anyway.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let ownerId: string;
let memberId: string;
const gameIds: string[] = [];

/**
 * SIX holes, not eighteen, and it matters for the suite as a whole.
 *
 * Idempotence needs a decided match with results to re-derive — it does not need
 * a full round, and an 18-hole seed here is 72 `score_entries` rows per game.
 * The whole vitest suite shares ONE local PostgREST/Kong, which 502s under peak
 * concurrency (the documented flake, and the reason `retry` is on in CI) — and
 * `retry` covers TESTS, not `beforeAll` hooks, so seeding load that pushes
 * another file's hook over the edge fails the run un-retried. Adding a heavy
 * seed to prove a light property is how a green suite becomes a flaky one.
 */
const HOLES = 6;

async function makeCompletedMatch(): Promise<string> {
  const id = genId("relock-idem");
  gameIds.push(id);
  const par = Array.from({ length: HOLES }, () => 4);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_match_play",
    name: "Relock Idempotence", status: "complete", corrections_open: false, scoring_enabled: true,
    scorecard_schema: { units: { count: HOLES, label: "hole", metadata: { par, handicap_index: par.map((_, i) => i + 1) } } },
    points_distribution: { type: "per_match", value: 2 }, points_total: 2,
    modifiers: {}, competition_format: "head_to_head",
    pairings_published_at: new Date(0).toISOString(),
  });
  await ctx.admin.from("game_participants").insert([
    { id: genId("p"), game_id: id, user_id: ownerId, handicap_strokes: 0 },
    { id: genId("p"), game_id: id, user_id: memberId, handicap_strokes: 0 },
  ]);
  const entries = [];
  for (let h = 1; h <= HOLES; h++) {
    entries.push(
      { id: genId("se"), game_id: id, participant_id: ownerId, participant_type: "user", unit_label: String(h), value: 4 },
      { id: genId("se"), game_id: id, participant_id: memberId, participant_type: "user", unit_label: String(h), value: 5 }
    );
  }
  await ctx.admin.from("score_entries").insert(entries);
  await ctx.admin.from("game_matches").insert({
    id: genId("gm"), game_id: id, match_number: 1, display_order: 0,
    side_a: { type: "user", id: ownerId }, side_b: { type: "user", id: memberId },
  });
  // Finalize once through the real procedure, so the "before" state is exactly
  // what a genuine save leaves behind rather than a hand-written approximation.
  await ctx.caller().games.finish({ tripId, gameId: id });
  return id;
}

/** Everything the board and the scorecard read back, in a comparable shape. */
async function snapshot(gameId: string) {
  const { data: game } = await ctx.admin
    .from("games").select("status, corrections_open, scoring_enabled").eq("id", gameId).single();
  const { data: results } = await ctx.admin
    .from("game_results").select("entity_id, entity_type, position, raw_score").eq("game_id", gameId)
    .order("entity_type").order("entity_id");
  const { data: matches } = await ctx.admin
    .from("game_matches").select("result, margin, status").eq("game_id", gameId).order("match_number");
  const { data: outcomes } = await ctx.admin
    .from("match_hole_outcomes").select("unit_label, result").eq("game_id", gameId).order("unit_label");
  const { data: scores } = await ctx.admin
    .from("score_entries").select("participant_id, unit_label, value").eq("game_id", gameId)
    .order("participant_id").order("unit_label");
  return { game, results, matches, outcomes, scores };
}

beforeAll(async () => {
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  tripId = await ctx.createTrip("Relock Idempotence Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "Relock Cup", { scoringModel: "match_play" });
}, 120000);

afterAll(async () => {
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds);
  await ctx.cleanup();
}, 60000);

describe("games.finish on a game that is already locked (the stale-CTA tap)", () => {
  it("is accepted, and changes nothing — same results, same margins, same scores", async () => {
    const gameId = await makeCompletedMatch();
    const before = await snapshot(gameId);
    expect(before.game?.corrections_open, "precondition: locked").toBe(false);
    expect(before.results?.length, "precondition: results exist").toBeGreaterThan(0);

    // The tap. It does NOT reject — `finish` is deliberately re-runnable (that is
    // what makes a re-lock the same call as a first finalize), so the redundant
    // call is admitted rather than refused.
    await ctx.caller().games.finish({ tripId, gameId });

    const after = await snapshot(gameId);
    expect(after.game).toEqual(before.game);
    expect(after.results).toEqual(before.results);
    expect(after.matches).toEqual(before.matches);
    expect(after.outcomes).toEqual(before.outcomes);
    // Scores are never touched by finalize — worth asserting explicitly, since
    // this is the failure that would actually matter on a golf course.
    expect(after.scores).toEqual(before.scores);
  }, 180000);

  it("stays unchanged across repeated taps (a double-tap is not a special case)", async () => {
    const gameId = await makeCompletedMatch();
    const before = await snapshot(gameId);
    await Promise.all([
      ctx.caller().games.finish({ tripId, gameId }),
      ctx.caller().games.finish({ tripId, gameId }),
    ]);
    const after = await snapshot(gameId);
    expect(after.game).toEqual(before.game);
    expect(after.results).toEqual(before.results);
    expect(after.matches).toEqual(before.matches);
    expect(after.scores).toEqual(before.scores);
  }, 180000);
});
