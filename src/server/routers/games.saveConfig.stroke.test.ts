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

/** Arm a scored stroke game: GROUP the roster (mandatory groupings, 089 — go-live now
 *  gates on grouped participants, mirroring rack) + go live + one score. The `groups`
 *  payload creates the participants AND assigns them a play_group in one atomic save. */
async function armScored(name: string): Promise<string> {
  const gameId = await newStrokeGame(name);
  await ctx.caller().games.saveConfig({
    tripId, gameId, baseHash: await hashOf(gameId),
    payload: {
      ...(await strokePayload(gameId, {})),
      groups: [{ name: "G1", userIds: [owner, member] }],
      groupsStructureDirty: true,
      pointsTotal: 2, // 093: a fresh enable on a competition game needs a real point value.
      scoringEnabled: true,
    },
  });
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

/**
 * 102 — removing a player from every grouping must remove their participation.
 *
 * Section 2b was insert-only ("upsert the roster union"), so a dropped player kept
 * their `game_participants` row with a NULL `play_group_id` — in the game, in no
 * group, with no scores. Found in production: seven such rows in one game, which the
 * stroke engine then aggregated at 0 strokes into a three-way tie for first.
 */
describe("102 — pruning participants dropped from every grouping", () => {
  async function groupedGame(name: string, userIds: string[]): Promise<string> {
    const gameId = await newStrokeGame(name);
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: {
        ...(await strokePayload(gameId, {})),
        groups: [{ name: "G1", userIds }],
        groupsStructureDirty: true,
      },
    });
    return gameId;
  }
  const participantsOf = async (gameId: string) =>
    (await ctx.admin.from("game_participants").select("user_id, play_group_id").eq("game_id", gameId)).data ?? [];

  it("removes an UNSCORED player dropped from every group", async () => {
    const gameId = await groupedGame("Prune unscored", [owner, member]);
    expect(await participantsOf(gameId)).toHaveLength(2);

    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: {
        ...(await strokePayload(gameId, {})),
        groups: [{ name: "G1", userIds: [owner] }],
        groupsStructureDirty: true,
      },
    });

    const rows = await participantsOf(gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: owner });
    // The old shape: still present, `play_group_id` null. That is what this asserts
    // against — not merely that the survivor is right.
    expect(rows.map((r) => r.user_id)).not.toContain(member);
  });

  it("re-grouping keeps everyone — the delete is removal-only, not a clean replace", async () => {
    // The regression risk of adding a DELETE here: it must not turn a re-shuffle into
    // a rebuild that drops and re-adds rows (which would churn ids and, with scores
    // present, be refused outright).
    const gameId = await groupedGame("Regroup", [owner, member]);
    const before = await participantsOf(gameId);

    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: {
        ...(await strokePayload(gameId, {})),
        groups: [{ name: "A", userIds: [owner] }, { name: "B", userIds: [member] }],
        groupsStructureDirty: true,
      },
    });

    const after = await participantsOf(gameId);
    expect(after).toHaveLength(2);
    expect(after.every((r) => r.play_group_id)).toBe(true);
    expect(new Set(after.map((r) => r.user_id))).toEqual(new Set(before.map((r) => r.user_id)));
  });

  it("still REFUSES to drop a scored player, and removes nobody when it does", async () => {
    // The guard above the delete is what protects scores; this pins that the new
    // delete did not weaken it, and that a refused save is atomic.
    const gameId = await armScored("Prune refused");
    await expect(
      ctx.caller().games.saveConfig({
        tripId, gameId, baseHash: await hashOf(gameId),
        payload: {
          ...(await strokePayload(gameId, {})),
          groups: [{ name: "G1", userIds: [member] }], // owner has a score
          groupsStructureDirty: true,
          scoringEnabled: true,
        },
      })
    ).rejects.toThrow(/HAS_SCORES/);
    expect(await participantsOf(gameId)).toHaveLength(2);
  });
});

describe("save_game_config — stroke (P2 flip): whole lean page saves; course is the one wall", () => {
  it("MODIFIERS write through AND survive a later omitted-slice save is impossible — always sent", async () => {
    const gameId = await newStrokeGame("Stroke modifiers");
    await save(gameId, { modifiers: { placeholder_modifier: {} } });
    expect((await getById(gameId)).modifiers).toEqual({ placeholder_modifier: {} });
    // A later save that changes ONLY the name still echoes modifiers (the payload builder
    // always includes them) → they persist, not wiped. This is the stroke-specific trap.
    await save(gameId, { name: "Renamed" });
    expect((await getById(gameId)).modifiers).toEqual({ placeholder_modifier: {} });
  });

  it("accepts an EMPTY name (standalone stroke) — the RPC preserves the title, never blanks it", async () => {
    // Standalone stroke games (created via /games/new, no competition) have no name, and
    // their whole page routes through saveConfig now — so an empty-name payload must be
    // accepted (zod) and preserve the existing title (RPC COALESCE). Regression: the E2E
    // critical path is exactly this go-live, and min(1) rejected it.
    const gameId = await newStrokeGame("Original title");
    await save(gameId, { name: "" });
    expect((await getById(gameId)).name).toBe("Original title");
  });

  it("no-op Save is byte-identical — the faithless-mirror guard for stroke", async () => {
    const gameId = await newStrokeGame("Stroke no-op");
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [owner, member] });
    await save(gameId, { pointsTotal: 8, modifiers: { placeholder_modifier: {} }, participants: [{ userId: owner, strokes: 3 }, { userId: member, strokes: 0 }] });
    const before = await hashOf(gameId);
    await save(gameId, {}); // re-send the same config
    expect(await hashOf(gameId)).toBe(before);
  });

  it("THE TAXONOMY — on a scored stroke game name/points/strokes/modifiers save; ONLY the course refuses", async () => {
    const gameId = await armScored("Stroke taxonomy");

    // Warned/Quiet: name + points + a stroke + a modifier, ALL in one save → SUCCEEDS live.
    await save(gameId, {
      name: "Renamed live", pointsTotal: 12, pointsDistribution: { type: "placement", values: [6, 4, 2] },
      modifiers: { placeholder_modifier: {} }, participants: [{ userId: owner, strokes: 5 }, { userId: member, strokes: 0 }],
    });
    const g = await getById(gameId);
    expect(g.name).toBe("Renamed live");
    expect(Number(g.points_total)).toBe(12);
    expect(g.modifiers).toEqual({ placeholder_modifier: {} });
    const strokesOf = new Map((g.participants ?? []).map((p) => [p.user_id, p.handicap_strokes]));
    expect(strokesOf.get(owner)).toBe(5);

    // Locked tier: ONLY a COURSE change is refused (mirrors applyCourse's own refusal;
    // change-gated on courseId/backCourseId/schema — a dummy id + schema is enough).
    await expect(
      save(gameId, { courseId: "some-course-id", scorecardSchema: { units: { count: 18 } } }),
    ).rejects.toThrow(/course/i);
  });

  it("C1: a placement split that no longer sums to the total is REJECTED at save", async () => {
    const gameId = await newStrokeGame("Stroke C1 dist gate");
    // Valid: 6+4+2 = 12 = total → saves.
    await save(gameId, { pointsTotal: 12, pointsDistribution: { type: "placement", values: [6, 4, 2] } });
    expect(Number((await getById(gameId)).points_total)).toBe(12);

    // Change the total to 10 while the split still sums to 12 → the server refine refuses
    // BEFORE the RPC (mirrors the client Save gate; the payload carries both fields).
    await expect(
      save(gameId, { pointsTotal: 10, pointsDistribution: { type: "placement", values: [6, 4, 2] } }),
    ).rejects.toThrow(/total/i);
    // Nothing persisted — total is still 12.
    expect(Number((await getById(gameId)).points_total)).toBe(12);

    // Fixing the split so it sums to the new total saves.
    await save(gameId, { pointsTotal: 10, pointsDistribution: { type: "placement", values: [6, 3, 1] } });
    expect(Number((await getById(gameId)).points_total)).toBe(10);

    // An UNDISTRIBUTED split (empty values) under any total still saves (the shell state).
    await save(gameId, { pointsTotal: 20, pointsDistribution: { type: "placement", values: [] } });
    expect(Number((await getById(gameId)).points_total)).toBe(20);
  });

  it("go-live requires GROUPED participants (089 mandatory groupings) — an ungrouped roster is NOT_READY", async () => {
    const gameId = await newStrokeGame("Stroke grouped readiness");
    // A bare roster with no playing group: ungrouped = not in the game → go-live refused
    // (stroke now mirrors rack — grouped-participant readiness).
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [owner, member] });
    // 093: isolate the GROUPING reason this test is about — give it a real point value
    // so the zero-points gate can't also fire and steal the assertion.
    await expect(save(gameId, { pointsTotal: 2, scoringEnabled: true })).rejects.toThrow(/setting up/i);

    // Put them in a group → ready → go-live succeeds.
    await ctx.caller().games.saveConfig({
      tripId, gameId, baseHash: await hashOf(gameId),
      payload: {
        ...(await strokePayload(gameId, {})),
        groups: [{ name: "G1", userIds: [owner, member] }],
        groupsStructureDirty: true,
        pointsTotal: 2, // 093: a fresh enable on a competition game needs a real point value.
        scoringEnabled: true,
      },
    });
    expect((await getById(gameId)).scoring_enabled).toBe(true);
  });
});
