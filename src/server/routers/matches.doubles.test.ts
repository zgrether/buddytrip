import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * 2v2 / doubles match play (Slice C). The side is a PAIR (a play_group), one
 * score is recorded per side per hole, and the SAME match engine
 * (computeMatchPlayResults) resolves the head-to-head — just with play_group
 * sides instead of user sides. These tests prove the sided path end-to-end:
 * pairings create the two sides, scoring is per side, and the result distills to
 * game_results with entity_type='play_group'.
 */

const DOUBLES = "gtt_match_play_doubles";

type Side = { type: string; id: string } | null;
interface MatchRow {
  id: string;
  side_a: Side;
  side_b: Side;
  result: string | null;
  margin: string | null;
  status: string;
}

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Doubles Match Play Trip");
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

/** Enter one score per SIDE per hole (participant_type='play_group'). */
async function enterSides(
  gameId: string,
  pgA: string,
  pgB: string,
  scoreA: Record<number, number>,
  scoreB: Record<number, number>
) {
  const caller = ctx.caller();
  await caller.games.enableScoring({ tripId, gameId }); // Phase 2B.1 universal gate
  for (const [h, v] of Object.entries(scoreA)) {
    await caller.scores.upsertEntry({ tripId, gameId, participantId: pgA, unitLabel: h, value: v, participantType: "play_group" });
  }
  for (const [h, v] of Object.entries(scoreB)) {
    await caller.scores.upsertEntry({ tripId, gameId, participantId: pgB, unitLabel: h, value: v, participantType: "play_group" });
  }
}

async function freshGame(name: string) {
  const game = await ctx.caller().games.create({ tripId, gameTypeId: DOUBLES, name });
  return game.id;
}

/** Pair (owner+planner) vs (member+outsider). Returns the two play_group ids. */
async function pairUp(gameId: string): Promise<{ pgA: string; pgB: string; matchId: string }> {
  const matches = (await ctx.caller().matches.setDoublesPairings({
    tripId,
    gameId,
    matches: [
      {
        sideA: { members: [owner, planner] },
        sideB: { members: [member, outsider] },
        matchNumber: 1,
      },
    ],
  })) as MatchRow[];
  const m = matches[0];
  return { pgA: m.side_a!.id, pgB: m.side_b!.id, matchId: m.id };
}

describe("doubles setup — sides are play_groups", () => {
  it("setDoublesPairings creates a play_group per side with its two members", async () => {
    const gameId = await freshGame("Pairing");
    const { pgA, pgB } = await pairUp(gameId);

    // Two distinct play_groups, both anchored to this game.
    const { data: pgs } = await ctx.admin.from("play_groups").select("id").eq("game_id", gameId);
    expect((pgs as { id: string }[]).map((p) => p.id).sort()).toEqual([pgA, pgB].sort());

    // Four participants, two on each side (play_group_id set).
    const { data: parts } = await ctx.admin
      .from("game_participants")
      .select("user_id, play_group_id")
      .eq("game_id", gameId);
    const rows = parts as { user_id: string; play_group_id: string | null }[];
    expect(rows).toHaveLength(4);
    const sideOf = (u: string) => rows.find((r) => r.user_id === u)?.play_group_id;
    expect(sideOf(owner)).toBe(pgA);
    expect(sideOf(planner)).toBe(pgA);
    expect(sideOf(member)).toBe(pgB);
    expect(sideOf(outsider)).toBe(pgB);

    // The match references the two play-group sides.
    const { data: matches } = await ctx.admin.from("game_matches").select("side_a, side_b").eq("game_id", gameId);
    const m = (matches as { side_a: Side; side_b: Side }[])[0];
    expect(m.side_a?.type).toBe("play_group");
    expect(m.side_b?.type).toBe("play_group");
  });

  it("setDoublesHandicap stores the side handicap on play_groups (recipient n, other 0)", async () => {
    const gameId = await freshGame("Side handicap");
    const { pgA, pgB, matchId } = await pairUp(gameId);
    await ctx.callerAs("planner").matches.setDoublesHandicap({
      tripId,
      gameId,
      matchId,
      recipientPlayGroupId: pgB,
      strokes: 2,
    });
    const { data } = await ctx.admin.from("play_groups").select("id, handicap_strokes").eq("game_id", gameId);
    const hcap = Object.fromEntries(
      (data as { id: string; handicap_strokes: number | null }[]).map((p) => [p.id, p.handicap_strokes])
    );
    expect(hcap[pgB]).toBe(2);
    expect(hcap[pgA]).toBe(0);
  });

  it("a plain Member cannot set doubles pairings", async () => {
    const gameId = await freshGame("Gate");
    await expect(
      ctx.callerAs("member").matches.setDoublesPairings({
        tripId,
        gameId,
        matches: [
          { sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 },
        ],
      })
    ).rejects.toThrow();
  });
});

describe("doubles results — one score per side, match engine reused", () => {
  it("closed-out 3&2 → a_win with game_results rows of entity_type='play_group'", async () => {
    const gameId = await freshGame("Close 3&2");
    const { pgA, pgB } = await pairUp(gameId);
    // Side A wins 1-3, halves 4-16 → +3 frozen at hole 16 = 3&2.
    const aHalf: Record<number, number> = {};
    const bHalf: Record<number, number> = {};
    for (let h = 4; h <= 16; h++) {
      aHalf[h] = 4;
      bHalf[h] = 4;
    }
    await enterSides(gameId, pgA, pgB, { 1: 4, 2: 4, 3: 4, ...aHalf }, { 1: 5, 2: 5, 3: 5, ...bHalf });

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ result: "a_win", margin: "3&2", status: "complete" });

    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, position, raw_score")
      .eq("game_id", gameId);
    const rows = results as { entity_id: string; entity_type: string; position: number; raw_score: number | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.entity_type === "play_group")).toBe(true);
    expect(rows.find((r) => r.entity_id === pgA)?.position).toBe(1);
    expect(rows.find((r) => r.entity_id === pgB)?.position).toBe(2);
    expect(rows.every((r) => r.raw_score === null)).toBe(true);
  });

  it("a received side stroke flips a hole (net), same as 1v1", async () => {
    const gameId = await freshGame("Side net");
    const { pgA, pgB, matchId } = await pairUp(gameId);
    // Side B gets 1 stroke → fallback puts it on hole 1.
    await ctx.caller().matches.setDoublesHandicap({ tripId, gameId, matchId, recipientPlayGroupId: pgB, strokes: 1 });
    // Hole 1: A gross 4, B gross 5 → B net 4 → halved, not an A win.
    await enterSides(gameId, pgA, pgB, { 1: 4 }, { 1: 5 });

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches[0].result).toBeNull(); // one halved hole, match not over
    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id, position")
      .eq("game_id", gameId);
    const rows = results as { entity_id: string; position: number }[];
    expect(rows.find((r) => r.entity_id === pgA)?.position).toBe(1);
    expect(rows.find((r) => r.entity_id === pgB)?.position).toBe(1);
  });
});

describe("doubles team integrity — same-team pairs + correct attribution", () => {
  let competitionId: string;
  let blue: string, red: string;

  beforeAll(async () => {
    competitionId = await ctx.createCompetition(tripId, "Ryder Cup");
    blue = await ctx.createTeam(competitionId, "Blue", { color: "#2563eb" });
    red = await ctx.createTeam(competitionId, "Red", { color: "#dc2626" });
    // owner+planner = Blue, member+outsider = Red.
    await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: owner, team_id: blue },
      { competition_id: competitionId, user_id: planner, team_id: blue },
      { competition_id: competitionId, user_id: member, team_id: red },
      { competition_id: competitionId, user_id: outsider, team_id: red },
    ]);
  });

  // A doubles game wired into the per_match competition (points value 2/match).
  async function compGame(name: string) {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: DOUBLES, name });
    await ctx.admin
      .from("games")
      .update({ competition_id: competitionId, points_distribution: { type: "per_match", value: 2 } })
      .eq("id", game.id);
    return game.id;
  }

  it("hard-blocks a cross-team pair (setup-integrity backstop)", async () => {
    const gameId = await compGame("Cross-team");
    await expect(
      ctx.caller().matches.setDoublesPairings({
        tripId,
        gameId,
        matches: [
          // owner=Blue + member=Red → a structurally invalid pair.
          { sideA: { members: [owner, member] }, sideB: { members: [planner, outsider] }, matchNumber: 1 },
        ],
      })
    ).rejects.toThrow(/same team/i);
  });

  it("accepts same-team pairs and rolls match points to the winning team", async () => {
    const gameId = await compGame("Blue vs Red");
    const matches = (await ctx.caller().matches.setDoublesPairings({
      tripId,
      gameId,
      matches: [
        { sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 },
      ],
    })) as MatchRow[];
    const pgA = matches[0].side_a!.id; // Blue
    const pgB = matches[0].side_b!.id; // Red

    // Blue closes the match out 3&2.
    const aHalf: Record<number, number> = {};
    const bHalf: Record<number, number> = {};
    for (let h = 4; h <= 16; h++) {
      aHalf[h] = 4;
      bHalf[h] = 4;
    }
    const caller = ctx.caller();
    await caller.games.enableScoring({ tripId, gameId }); // Phase 2B.1 universal gate
    for (const [h, v] of Object.entries({ 1: 4, 2: 4, 3: 4, ...aHalf })) {
      await caller.scores.upsertEntry({ tripId, gameId, participantId: pgA, unitLabel: h, value: v, participantType: "play_group" });
    }
    for (const [h, v] of Object.entries({ 1: 5, 2: 5, 3: 5, ...bHalf })) {
      await caller.scores.upsertEntry({ tripId, gameId, participantId: pgB, unitLabel: h, value: v, participantType: "play_group" });
    }

    await ctx.caller().games.finish({ tripId, gameId });

    // The per_match value (2) lands on Blue's team total, not Red's.
    const { data: teamRows } = await ctx.admin
      .from("game_results")
      .select("entity_id, entity_type, raw_score")
      .eq("game_id", gameId)
      .eq("entity_type", "team");
    const byTeam = Object.fromEntries(
      (teamRows as { entity_id: string; raw_score: number | null }[]).map((r) => [r.entity_id, r.raw_score])
    );
    expect(byTeam[blue]).toBe(2);
    expect(byTeam[red] ?? 0).toBe(0);
  });
});
