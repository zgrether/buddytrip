import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * save_game_config — the FINALIZED guard (migration 111).
 *
 * A completed game keeps its settings OPEN. Two classes of edit behave
 * differently and this pins the split:
 *
 *   allowed   name / rules / assignee / POINTS — points recompute at read from
 *             the stored `position`, so re-pointing a finished game moves the
 *             leaderboard correctly and rewrites nothing.
 *   refused   course / matchups / groupings / handicaps — `game_results` was
 *             snapshotted at finalize, so these would leave the stored result
 *             describing a game that no longer exists.
 *
 * The subtle requirement, and the one worth a test: the settings page sends its
 * WHOLE draft on every save, so a name-only edit re-sends unchanged handicaps
 * and groupings. If the guard fired on payload PRESENCE rather than on a real
 * difference, a completed game would be editable in name only — the exact bug
 * this item exists to fix, reintroduced by its own fix.
 */

const STROKE = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, member: string;
const gameIds: string[] = [];

interface Payload {
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
  groups?: { name: string; userIds: string[] }[];
  groupsStructureDirty?: boolean;
}

async function getById(gameId: string) {
  return (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown> & {
    participants?: { user_id: string; handicap_strokes: number | null }[];
  };
}
async function hashOf(gameId: string) {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

/** Echo the game's current config, so a save changes ONLY the overrides — the
 *  same thing the settings page does on every Save. */
async function payload(gameId: string, over: Partial<Payload>): Promise<Payload> {
  const g = await getById(gameId);
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
async function save(gameId: string, over: Partial<Payload>) {
  await ctx.caller().games.saveConfig({
    tripId, gameId, baseHash: await hashOf(gameId), payload: await payload(gameId, over),
  });
}

/**
 * ONE finalized stroke game, shared by every test here.
 *
 * `games.finish` refuses unless at least one player has completed all 18 holes,
 * so each fixture costs 18 score writes — six of them would be a 100+ write
 * `beforeAll`, which is exactly the seed size CLAUDE.md's local-stack
 * conventions warn flakes under load. Sharing is safe because the two groups
 * don't collide: the "allowed" tests each write a DIFFERENT field, and the
 * "refused" tests are refusals, which by definition write nothing.
 */
let finalizedGameId: string;

async function makeFinalizedGame(): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Finalized", competitionId })) as { id: string };
  gameIds.push(g.id);
  await ctx.caller().games.saveConfig({
    tripId, gameId: g.id, baseHash: await hashOf(g.id),
    payload: {
      ...(await payload(g.id, {})),
      groups: [{ name: "G1", userIds: [owner, member] }],
      groupsStructureDirty: true,
      pointsTotal: 2,
      scoringEnabled: true,
    },
  });
  // The OWNER completes the round; one qualified player satisfies `finish`.
  for (let h = 1; h <= 18; h++) {
    await ctx.caller().scores.upsertEntry({
      tripId, gameId: g.id, participantId: owner, participantType: "user", unitLabel: String(h), value: 4,
    });
  }
  await ctx.caller().games.finish({ tripId, gameId: g.id });
  expect((await getById(g.id)).status).toBe("complete");
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig finalized Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "saveConfig finalized Cup");
  finalizedGameId = await makeFinalizedGame();
}, 90_000);

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("score_entries").delete().in("game_id", gameIds);
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("play_groups").delete().in("game_id", gameIds);
    await ctx.admin.from("game_delegates").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

describe("a finalized game keeps its settings editable", () => {
  it("a name-only save succeeds — the whole draft is re-sent and nothing trips", async () => {
    // The load-bearing case. Every field the guard watches is present in this
    // payload and UNCHANGED; only a difference may refuse.
    const gameId = finalizedGameId;
    await save(gameId, { name: "Renamed after finishing" });
    expect((await getById(gameId)).name).toBe("Renamed after finishing");
  }, 60_000);

  it("rules of the day are editable after finishing", async () => {
    const gameId = finalizedGameId;
    await save(gameId, { rulesForToday: "Winner buys." });
    expect((await getById(gameId)).rules_for_today).toBe("Winner buys.");
  }, 60_000);

  it("POINTS are editable after finishing — they recompute at read", async () => {
    const gameId = finalizedGameId;
    await save(gameId, { pointsTotal: 9 });
    expect((await getById(gameId)).points_total).toBe(9);
  }, 60_000);
});

describe("saving a finalized game does not un-finalize it", () => {
  it("status stays complete, and scoring_enabled / pairings_published_at don't move", async () => {
    // The bug this pins: `finish` leaves `scoring_enabled` TRUE (a finished game
    // is re-scoreable), so every settings save echoes `scoringEnabled: true`,
    // the RPC's go-live block ran, and it set `status = 'active'` with a fresh
    // `pairings_published_at`. A renamed finished game quietly rejoined the live
    // section of the board with its result still posted.
    //
    // It survived because the two formats most likely to reach it hid the gear
    // on a complete game — so opening the gear (this change's other half) would
    // have turned an invisible bug into a one-tap one. CLAUDE.md #25: the three
    // go-live signals move together, and on a finished game none of them move.
    const gameId = finalizedGameId;
    const before = await getById(gameId);
    expect(before.status).toBe("complete");

    await save(gameId, { name: "Still finished" });

    const after = await getById(gameId);
    expect(after.status).toBe("complete");
    expect(after.scoring_enabled).toBe(before.scoring_enabled);
    expect(after.pairings_published_at).toEqual(before.pairings_published_at);
  }, 60_000);
});

describe("a finalized game refuses standings-affecting edits", () => {
  it("refuses a handicap change, naming the reason", async () => {
    const gameId = finalizedGameId;
    const parts = (await getById(gameId)).participants ?? [];
    await expect(
      save(gameId, { participants: parts.map((p) => ({ userId: p.user_id, strokes: 7 })) }),
    // The message is the SENTENCE, not the code — #942 stopped `save_game_config`
    // refusals reaching the user as `FINAL_LOCKED: …`. It must still NAME what is
    // frozen, which is exactly why the codes are UNWRAPPED rather than replaced
    // with generic per-code copy: a rewrite loses "handicaps".
    ).rejects.toThrow(/result was recorded against the current handicaps/);
  }, 60_000);

  it("and the refusal carries no internal code", async () => {
    // The `Save failed: ${msg}` fallthrough was the real defect: four of nine
    // codes leaked, and any code added later would have too.
    const gameId = finalizedGameId;
    const parts = (await getById(gameId)).participants ?? [];
    await expect(
      save(gameId, { participants: parts.map((p) => ({ userId: p.user_id, strokes: 7 })) }),
    ).rejects.toThrow(/^(?![\s\S]*FINAL_LOCKED)[\s\S]*$/);
  }, 60_000);

  it("refuses a groupings change", async () => {
    const gameId = finalizedGameId;
    await expect(
      save(gameId, { groups: [{ name: "Solo", userIds: [owner] }], groupsStructureDirty: true }),
    ).rejects.toThrow(/result was recorded against the current groupings|already has scores/);
  }, 60_000);

  it("the refusal leaves the stored handicap untouched", async () => {
    const gameId = finalizedGameId;
    const before = (await getById(gameId)).participants ?? [];
    await expect(
      save(gameId, { participants: before.map((p) => ({ userId: p.user_id, strokes: 5 })) }),
    ).rejects.toThrow(/this game is finished/);
    const after = (await getById(gameId)).participants ?? [];
    for (const p of after) expect(p.handicap_strokes).toBeNull();
  }, 60_000);
});
