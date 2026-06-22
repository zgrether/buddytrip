import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Reset primitives (WS4) — competitions.resetScoring / resetToSkeleton.
 *
 * Exercises the two transactional plpgsql primitives (migration 063) through
 * their tRPC procedures. Fixtures are built directly via the admin client so each
 * game's pre-state (config + scoring buckets) is exact and the test subject is the
 * RESET logic itself, not the scoring pipeline (covered elsewhere).
 *
 * The buckets under test (Phase-0 audit):
 *  - resetScoring clears RESULTS, keeps CONFIG + IDENTITY, keeps scoring_enabled.
 *  - resetToSkeleton = resetScoring + clears CONFIG, keeps IDENTITY, un-arms.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let ownerId: string;
let memberId: string;
const gameIds: string[] = [];

function gid(prefix: string) {
  return genId(prefix);
}

/** A scored STROKE game: course + roster (2) + handicaps (config); scores +
 *  results (scoring); placement points (identity total + config split). */
async function makeStrokeGame(): Promise<string> {
  const id = gid("reset-stroke");
  gameIds.push(id);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_stroke_play",
    name: "Stroke", status: "complete", corrections_open: true, scoring_enabled: true,
    course_id: null, // course optional; left null to avoid a course fixture
    scorecard_schema: { units: { metadata: { par: [4, 4] } } },
    points_distribution: { type: "placement", values: [5, 3] }, points_total: 8,
    modifiers: { glorious_holes: {} }, rules_for_today: "be nice", competition_format: "head_to_head",
    pairings_published_at: new Date(0).toISOString(),
  });
  await ctx.admin.from("game_participants").insert([
    { id: gid("p"), game_id: id, user_id: ownerId, handicap_strokes: 4 },
    { id: gid("p"), game_id: id, user_id: memberId, handicap_strokes: 9 },
  ]);
  await ctx.admin.from("score_entries").insert([
    { id: gid("se"), game_id: id, participant_id: ownerId, participant_type: "user", unit_label: "1", value: 4 },
    { id: gid("se"), game_id: id, participant_id: memberId, participant_type: "user", unit_label: "1", value: 5 },
  ]);
  await ctx.admin.from("game_results").insert([
    { id: gid("gr"), game_id: id, entity_id: ownerId, entity_type: "user", position: 1, raw_score: 4 },
    { id: gid("gr"), game_id: id, entity_id: memberId, entity_type: "user", position: 2, raw_score: 5 },
  ]);
  return id;
}

/** A scored 1v1 MATCH game: a pairing (config: side_a/side_b) carrying a result
 *  (scoring: result/margin/status) — the dual-bucket game_matches row. Per-match
 *  points (the value is IDENTITY, kept by skeleton). */
async function makeMatchGame(): Promise<string> {
  const id = gid("reset-match");
  gameIds.push(id);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_match_play_singles",
    name: "Match", status: "complete", corrections_open: false, scoring_enabled: true,
    points_distribution: { type: "per_match", value: 2 }, points_total: null,
  });
  await ctx.admin.from("game_participants").insert([
    { id: gid("p"), game_id: id, user_id: ownerId, handicap_strokes: 0 },
    { id: gid("p"), game_id: id, user_id: memberId, handicap_strokes: 0 },
  ]);
  const { error: gmErr } = await ctx.admin.from("game_matches").insert({
    id: gid("gm"), game_id: id, match_number: 1, display_order: 0,
    side_a: { type: "user", id: ownerId }, side_b: { type: "user", id: memberId },
    result: "a_win", margin: "2up", status: "complete", // result ∈ {a_win,b_win,halve}
  });
  if (gmErr) throw new Error(`game_matches insert failed: ${gmErr.message}`);
  await ctx.admin.from("game_results").insert({
    id: gid("gr"), game_id: id, entity_id: ownerId, entity_type: "user", position: 1, raw_score: 1,
  });
  return id;
}

/** A scored 2v2 game with play_groups (config: the pairs + side handicaps). */
async function makeDoublesGame(): Promise<string> {
  const id = gid("reset-doubles");
  gameIds.push(id);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_match_play_doubles",
    name: "Doubles", status: "active", scoring_enabled: true,
    points_distribution: { type: "per_match", value: 1 },
  });
  const pgId = gid("pg");
  await ctx.admin.from("play_groups").insert({ id: pgId, game_id: id, display_name: null, handicap_strokes: 3 });
  await ctx.admin.from("game_participants").insert({ id: gid("p"), game_id: id, user_id: ownerId, play_group_id: pgId });
  return id;
}

/** A non-golf MANUAL game: placements only (no course/roster/pairings). Config =
 *  the placement split + format + rules; identity = its point total. */
async function makeManualGame(): Promise<string> {
  const id = gid("reset-manual");
  gameIds.push(id);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_manual",
    name: "Cornhole", status: "complete", scoring_enabled: true,
    points_distribution: { type: "placement", values: [5, 3] }, points_total: 8,
    competition_format: "head_to_head", rules_for_today: "best of 3",
  });
  await ctx.admin.from("game_results").insert([
    { id: gid("gr"), game_id: id, entity_id: teamA, entity_type: "team", position: 1, raw_score: 1 },
    { id: gid("gr"), game_id: id, entity_id: teamB, entity_type: "team", position: 2, raw_score: 2 },
  ]);
  return id;
}

async function gameRow(id: string) {
  const { data } = await ctx.admin.from("games").select("*").eq("id", id).single();
  return data as Record<string, unknown>;
}
async function count(table: string, gameId: string): Promise<number> {
  const { count: c } = await ctx.admin.from(table).select("id", { count: "exact", head: true }).eq("game_id", gameId);
  return c ?? 0;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  tripId = await ctx.createTrip("Reset Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // co_admin — NOT owner
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "Reset Cup", { scoringModel: "points" });
  teamA = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  teamB = await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
});

afterAll(async () => {
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds); // cascade clears children
  await ctx.cleanup();
}, 30000);

describe("resetScoring — clears results, keeps config + identity, stays armed", () => {
  it("clears scoring buckets across game types but leaves config intact", async () => {
    const stroke = await makeStrokeGame();
    const match = await makeMatchGame();
    const manual = await makeManualGame();

    await ctx.caller().competitions.resetScoring({ tripId, competitionId });

    // SCORING cleared everywhere.
    expect(await count("game_results", stroke)).toBe(0);
    expect(await count("score_entries", stroke)).toBe(0);
    expect(await count("game_results", match)).toBe(0);
    expect(await count("game_results", manual)).toBe(0);

    // CONFIG intact (stroke): roster + handicaps + course schema + points all survive.
    expect(await count("game_participants", stroke)).toBe(2);
    const sg = await gameRow(stroke);
    expect(sg.scorecard_schema).not.toBeNull();
    expect(sg.points_total).toBe(8);
    expect(sg.points_distribution).toMatchObject({ type: "placement" });
    expect(sg.modifiers).toMatchObject({ glorious_holes: {} });
    expect(sg.competition_format).toBe("head_to_head");
    // Unscored lifecycle, but STILL ARMED (scoring_enabled kept).
    expect(sg.status).toBe("pending");
    expect(sg.corrections_open).toBe(false);
    expect(sg.scoring_enabled).toBe(true);

    // Match: the dual-bucket game_matches row SURVIVES with its pairing, but its
    // RESULT columns are nulled and status reset.
    expect(await count("game_matches", match)).toBe(1);
    const { data: gm } = await ctx.admin.from("game_matches").select("*").eq("game_id", match).single();
    const m = gm as Record<string, unknown>;
    expect(m.side_a).toMatchObject({ type: "user", id: ownerId }); // pairing kept
    expect(m.result).toBeNull();
    expect(m.margin).toBeNull();
    expect(m.status).toBe("pending");
  });

  it("a non-owner (co_admin) cannot reset scoring", async () => {
    await expect(
      ctx.callerAs("planner").competitions.resetScoring({ tripId, competitionId })
    ).rejects.toThrow();
  });
});

describe("resetToSkeleton — also clears config, keeps identity, un-arms", () => {
  it("clears config across game types but leaves identity (shell + teams + point value)", async () => {
    const stroke = await makeStrokeGame();
    const match = await makeMatchGame();
    const doubles = await makeDoublesGame();
    const manual = await makeManualGame();

    await ctx.caller().competitions.resetToSkeleton({ tripId, competitionId });

    // CONFIG cleared: roster, pairings, foursomes.
    expect(await count("game_participants", stroke)).toBe(0);
    expect(await count("game_matches", match)).toBe(0);
    expect(await count("game_participants", match)).toBe(0);
    expect(await count("play_groups", doubles)).toBe(0);
    expect(await count("game_participants", doubles)).toBe(0);

    // Stroke shell: config columns cleared, identity kept, un-armed.
    const sg = await gameRow(stroke);
    expect(sg.course_id).toBeNull();
    expect(sg.scorecard_schema).toBeNull();
    expect(sg.modifiers).toMatchObject({}); // reset to '{}'
    expect(sg.rules_for_today).toBeNull();
    expect(sg.competition_format).toBeNull();
    expect(sg.pairings_published_at).toBeNull();
    expect(sg.scoring_enabled).toBe(false);
    // IDENTITY survives: placement point VALUE kept; only the SPLIT cleared.
    expect(sg.points_total).toBe(8);
    expect(sg.points_distribution).toBeNull();
    expect(sg.name).toBe("Stroke"); // shell identity
    expect(sg.game_type_id).toBe("gtt_stroke_play");

    // Per-match distribution is the point VALUE (identity) — KEPT, not nulled.
    const mg = await gameRow(match);
    expect(mg.points_distribution).toMatchObject({ type: "per_match", value: 2 });

    // Manual: format/rules/split cleared, total kept.
    const ng = await gameRow(manual);
    expect(ng.competition_format).toBeNull();
    expect(ng.rules_for_today).toBeNull();
    expect(ng.points_distribution).toBeNull();
    expect(ng.points_total).toBe(8);

    // IDENTITY at competition level: teams survive both resets.
    const { count: teamCount } = await ctx.admin
      .from("teams").select("id", { count: "exact", head: true }).eq("competition_id", competitionId);
    expect(teamCount).toBe(2);
  });

  it("a plain member cannot reset to skeleton", async () => {
    await expect(
      ctx.callerAs("member").competitions.resetToSkeleton({ tripId, competitionId })
    ).rejects.toThrow();
  });
});
