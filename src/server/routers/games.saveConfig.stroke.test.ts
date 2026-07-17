import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * save_game_config — the STROKE flip (P2 phase 4). Stroke routes its whole page (name /
 * rules / delegate / points / course / per-player strokes / MODIFIERS) through the one
 * atomic Save, using the StrokeConfigDraft variant. Its taxonomy: the COURSE is the one
 * locked tier (a course change on a scored game orphans the snapshot the scores net
 * against — COURSE_LOCKED); strokes + modifiers are the warned/in-place tier; everything
 * else is quiet. No `groups`/`matches` keys (the RPC skips both blocks). The stroke-
 * specific concern is MODIFIERS: they must be sent EXPLICITLY every save (the RPC defaults
 * a missing key to `{}`, which would silently wipe them).
 */

const STROKE = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, member: string;
const gameIds: string[] = [];

interface StrokePayload {
  name: string;
  rulesForToday: string | null;
  scoringEnabled: boolean;
  pointsTotal: number | null;
  pointsDistribution: unknown;
  modifiers: Record<string, Record<string, unknown>>;
  courseId: string | null;
  backCourseId: string | null;
  scorecardSchema: unknown;
  delegates: string[];
  participants?: { userId: string; strokes: number }[];
}

async function newStrokeGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name, competitionId })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}
async function getById(gameId: string) {
  return (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown> & {
    participants?: { user_id: string; handicap_strokes: number | null }[];
  };
}
async function hashOf(gameId: string) {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

/** Echo the game's current config as the stroke payload base (so a save changes ONLY the
 *  overrides). Modifiers + participants are ALWAYS included — the two that self-wipe if
 *  omitted / drift if not echoed. */
async function strokePayload(gameId: string, over: Partial<StrokePayload>): Promise<StrokePayload> {
  const g = await getById(gameId);
  const orgs = (await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[];
  const parts = g.participants ?? [];
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
    participants: parts.map((p) => ({ userId: p.user_id, strokes: p.handicap_strokes ?? 0 })),
    ...over,
  };
}

async function save(gameId: string, over: Partial<StrokePayload>) {
  await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload: await strokePayload(gameId, over) });
}

/** Arm a scored stroke game: roster + go live + one score. */
async function armScored(name: string): Promise<string> {
  const gameId = await newStrokeGame(name);
  await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [owner, member] });
  await save(gameId, { scoringEnabled: true });
  await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: owner, participantType: "user", unitLabel: "1", value: 4 });
  return gameId;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig stroke Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "saveConfig stroke Cup");
});
afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("score_entries").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("game_delegates").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("save_game_config — stroke (P2 flip): whole lean page saves; course is the one wall", () => {
  it("MODIFIERS write through AND survive a later omitted-slice save is impossible — always sent", async () => {
    const gameId = await newStrokeGame("Stroke modifiers");
    await save(gameId, { modifiers: { moving_tees: {} } });
    expect((await getById(gameId)).modifiers).toEqual({ moving_tees: {} });
    // A later save that changes ONLY the name still echoes modifiers (the payload builder
    // always includes them) → they persist, not wiped. This is the stroke-specific trap.
    await save(gameId, { name: "Renamed" });
    expect((await getById(gameId)).modifiers).toEqual({ moving_tees: {} });
  });

  it("no-op Save is byte-identical — the faithless-mirror guard for stroke", async () => {
    const gameId = await newStrokeGame("Stroke no-op");
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [owner, member] });
    await save(gameId, { pointsTotal: 8, modifiers: { moving_tees: {} }, participants: [{ userId: owner, strokes: 3 }, { userId: member, strokes: 0 }] });
    const before = await hashOf(gameId);
    await save(gameId, {}); // re-send the same config
    expect(await hashOf(gameId)).toBe(before);
  });

  it("THE TAXONOMY — on a scored stroke game name/points/strokes/modifiers save; ONLY the course refuses", async () => {
    const gameId = await armScored("Stroke taxonomy");

    // Warned/Quiet: name + points + a stroke + a modifier, ALL in one save → SUCCEEDS live.
    await save(gameId, {
      name: "Renamed live", pointsTotal: 12, pointsDistribution: { type: "placement", values: [6, 4, 2] },
      modifiers: { moving_tees: {} }, participants: [{ userId: owner, strokes: 5 }, { userId: member, strokes: 0 }],
    });
    const g = await getById(gameId);
    expect(g.name).toBe("Renamed live");
    expect(Number(g.points_total)).toBe(12);
    expect(g.modifiers).toEqual({ moving_tees: {} });
    const strokesOf = new Map((g.participants ?? []).map((p) => [p.user_id, p.handicap_strokes]));
    expect(strokesOf.get(owner)).toBe(5);

    // Locked tier: ONLY a COURSE change is refused (mirrors applyCourse's own refusal;
    // change-gated on courseId/backCourseId/schema — a dummy id + schema is enough).
    await expect(
      save(gameId, { courseId: "some-course-id", scorecardSchema: { units: { count: 18 } } }),
    ).rejects.toThrow(/course/i);
  });
});
