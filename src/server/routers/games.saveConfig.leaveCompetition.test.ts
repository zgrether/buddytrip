import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Migration 218 — Play it as a side game: `save_game_config`'s
 * `leaveCompetition` takes a game OUT of its competition (#1668 look, item 3).
 *
 * Every limit is the RPC's, so every case goes through `games.saveConfig`, the
 * one front door the settings page uses:
 *   - it leaves, and the same save's go-live then skips the zero-points refusal
 *     (with a CONTROL: the identical save without the key is refused, so the
 *     leave is what admitted it, not some other path);
 *   - refused once the game has a score;
 *   - refused for a format that cannot be a side game;
 *   - refused for a delegate (with a CONTROL: the same delegate's ordinary save
 *     goes through, so the refusal is the leave and not the edit).
 *
 * Payloads echo the game's current config, the pattern the stroke saveConfig
 * suite uses (`games.saveConfig.stroke.test.ts`): every key the real stroke
 * caller sends is present, so the RPC takes the same branches it takes for the
 * app, and the only thing a case varies is the key under test.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, member: string, planner: string;

type Payload = Record<string, unknown>;

async function game(gameId: string) {
  const { data, error } = await ctx.admin
    .from("games")
    .select("competition_id, points_total, points_distribution, scoring_enabled")
    .eq("id", gameId)
    .single();
  if (error) throw error;
  return data as { competition_id: string | null; points_total: number | null; points_distribution: unknown; scoring_enabled: boolean };
}

async function hashOf(gameId: string) {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

async function payloadOf(gameId: string, over: Payload): Promise<Payload> {
  const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown> & {
    participants?: { user_id: string; handicap_strokes: number | null }[];
  };
  const orgs = (await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[];
  return {
    name: (g.name as string) ?? "Game",
    rulesForToday: (g.rules_for_today as string | null) ?? null,
    scoringEnabled: (g.scoring_enabled as boolean) ?? false,
    pointsTotal: (g.points_total as number | null) ?? null,
    pointsDistribution: g.points_distribution ?? null,
    modifiers: (g.modifiers as Record<string, Record<string, unknown>>) ?? {},
    courseId: (g.course_id as string | null) ?? null,
    backCourseId: (g.back_course_id as string | null) ?? null,
    scorecardSchema: g.scorecard_schema ?? null,
    delegates: orgs.map((d) => d.user_id),
    participants: (g.participants ?? []).map((p) => ({ userId: p.user_id, strokes: p.handicap_strokes ?? 0 })),
    ...over,
  };
}

async function save(gameId: string, over: Payload, as: "owner" | "member" = "owner") {
  const caller = as === "owner" ? ctx.caller() : ctx.callerAs("member");
  return caller.games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload: (await payloadOf(gameId, over)) as never });
}

/** A grouped cup game nobody has scored, worth 0 points (as games.create leaves it). */
async function cupGame(gameTypeId: string, name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId, name, competitionId })) as { id: string };
  await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [owner, member] });
  await ctx.groupStrokeParticipants(g.id, [owner, member]);
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  planner = ctx.getUser("planner").id;
  ({ tripId, competitionId } = await ctx.createCupTrip({
    name: "218 side game",
    scoringModel: "points",
    teams: ["Alpha", "Bravo"],
    members: [["member", "Member"], ["planner", "Organizer"]],
  }));
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("Play it as a side game", () => {
  it("CONTROL: going live with no point value is refused while the game is in the cup", async () => {
    const gameId = await cupGame("gtt_stroke_play", "control");
    await expect(save(gameId, { scoringEnabled: true })).rejects.toThrow(/point value/i);
    expect((await game(gameId)).competition_id).toBe(competitionId);
  });

  it("leaves the cup and goes live in the same save; its points go with it", async () => {
    const gameId = await cupGame("gtt_stroke_play", "leaves");
    const before = await hashOf(gameId);
    await save(gameId, { scoringEnabled: true, leaveCompetition: true });
    const after = await game(gameId);
    expect(after).toMatchObject({ competition_id: null, points_total: null, points_distribution: null, scoring_enabled: true });
    // The fingerprint moves, so another device with this game open learns of it.
    expect(await hashOf(gameId)).not.toBe(before);
    // It is now a side game where the app looks for one.
    const board = (await ctx.caller().games.sideBoard({ tripId })) as unknown as { games?: { id: string }[] } | { id: string }[];
    expect(JSON.stringify(board)).toContain(gameId);
  });

  it("is refused once the game has a score, and the game stays in the cup", async () => {
    const gameId = await cupGame("gtt_stroke_play", "scored");
    await save(gameId, { scoringEnabled: true, pointsTotal: 2 });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 4 });
    await expect(save(gameId, { leaveCompetition: true })).rejects.toThrow(/already has scores/);
    expect((await game(gameId)).competition_id).toBe(competitionId);
  });

  it("is refused for a format that cannot be a side game", async () => {
    const gameId = await cupGame("gtt_scramble", "scramble");
    await expect(save(gameId, { leaveCompetition: true })).rejects.toThrow(/Only stroke play, match play and skins can be side games/);
    expect((await game(gameId)).competition_id).toBe(competitionId);
  });

  it("is refused for a delegate, who can still save the game otherwise", async () => {
    const gameId = await cupGame("gtt_stroke_play", "delegate");
    const grant = await ctx.admin.from("game_delegates").insert({ game_id: gameId, user_id: member, granted_by: owner });
    if (grant.error) throw grant.error;
    // CONTROL: the delegate's ordinary save goes through.
    await save(gameId, { rulesForToday: "delegate was here" }, "member");
    await expect(save(gameId, { leaveCompetition: true }, "member")).rejects.toThrow(/Only an organizer can make this a side game/);
    expect((await game(gameId)).competition_id).toBe(competitionId);
  });

  it("an Organizer may, not only the Owner", async () => {
    const gameId = await cupGame("gtt_stroke_play", "organizer");
    const caller = ctx.callerAs("planner");
    await caller.games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload: (await payloadOf(gameId, { leaveCompetition: true })) as never });
    expect((await game(gameId)).competition_id).toBeNull();
    expect(planner).toBeTruthy();
  });

  it("a side game already: the key is a no-op", async () => {
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "already side", competitionId: null })) as { id: string };
    await save(g.id, { leaveCompetition: true });
    expect((await game(g.id)).competition_id).toBeNull();
  });
});
