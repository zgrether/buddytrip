import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * `save_game_config` writes `games.config`, and the SCORING TYPE is fixed once a
 * game starts producing results (migration 179).
 *
 * ── Why this calls the RPC directly and not through tRPC ────────────────────
 *
 * 179 is a migration-only change. The tRPC `saveConfig` input is a `z.object`,
 * which STRIPS unknown keys, so a `config` sent through the router would never
 * reach the RPC until the client half lands. Asserting through tRPC here would
 * therefore fail against CORRECT migration code — a red test naming the wrong
 * cause, which is the expensive direction (CLAUDE.md: "the other symptom is a
 * red test"). `authedClient` exists for exactly this: a real `authenticated`
 * JWT calling a SECURITY DEFINER function, which is the layer 179 changes.
 *
 * ── The wrong builds these cases exist to fail ──────────────────────────────
 *
 * Each case names one, because they do not all fail the same assertion and
 * several of them pass a subset of this file:
 *
 *   · NO WRITE — the column is never written. Fails `persists`.
 *   · THE `modifiers` SHAPE — `COALESCE(p_payload->'config', '{}')`, which is
 *     what copying the line directly above it in the UPDATE produces. Every
 *     save from a format that does not own the key silently wipes how a round
 *     scores. Fails `preserves`, and NOTHING ELSE in this file — which is the
 *     reason that case exists rather than being folded into `persists`.
 *   · NO GUARD — fails `refuses a change once started`.
 *   · A PRESENCE-CHECKING GUARD — refuses on `p_payload ? 'config'` rather than
 *     on a changed VALUE. It passes every refusal case here and bricks every
 *     ordinary settings save on a live Stableford game. Caught ONLY by
 *     `allows an unchanged re-send once started`.
 *   · A TYPE-ONLY GUARD — locks `scoringType` and leaves the rubric editable.
 *     Caught only by `refuses a RUBRIC-only change once started`; every other
 *     refusal case passes against it.
 *   · A WHOLE-COLUMN GUARD — locks all of `config` rather than the scoring
 *     block, so an unrelated setting stored beside it becomes unwritable the
 *     moment a game starts. Caught only by `allows a non-scoring config key`.
 *
 * ── Why the fixture inserts `score_entries` directly ───────────────────────
 *
 * The guard reads `public.game_started`, whose golf arm is `SELECT DISTINCT
 * game_id FROM score_entries`. A row there is precisely what
 * `scores.upsertEntry` produces and is the whole of what the view reads for a
 * stroke game, so the direct insert is faithful to the real caller for this
 * predicate — it is not a hand-rolled stand-in for a payload shape (the class
 * of fixture CLAUDE.md warns about). Going through the tRPC score path would
 * additionally require go-live, groupings and a point value, none of which the
 * guard reads.
 */

const STROKE = "gtt_stroke_play";

const STANDARD = { preset: "standard", ceiling: -3, floor: 2, points: [5, 4, 3, 2, 1, 0] };
const BBMI_2024 = { preset: "bbmi_2024", ceiling: -2, floor: 3, points: [9, 6, 4, 2, 1, 0] };

let ctx: TestContext;
let tripId: string;
const gameIds: string[] = [];

type Cfg = Record<string, unknown>;

async function newStrokeGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

async function configOf(gameId: string): Promise<Cfg> {
  const { data } = await ctx.admin.from("games").select("config").eq("id", gameId).single();
  return (data?.config ?? {}) as Cfg;
}

/** Echo the game's current scalars so a save changes ONLY what `over` names. */
async function payload(gameId: string, over: Record<string, unknown>) {
  const { data } = await ctx.admin
    .from("games")
    .select("name, rules_for_today, scoring_enabled, points_total, points_distribution, course_id, back_course_id, scorecard_schema, modifiers")
    .eq("id", gameId)
    .single();
  const g = (data ?? {}) as Record<string, unknown>;
  return {
    name: (g.name as string) ?? "Game",
    rulesForToday: (g.rules_for_today as string | null) ?? null,
    scoringEnabled: (g.scoring_enabled as boolean) ?? false,
    pointsTotal: (g.points_total as number | null) ?? null,
    pointsDistribution: g.points_distribution ?? null,
    modifiers: g.modifiers ?? {},
    courseId: (g.course_id as string | null) ?? null,
    backCourseId: (g.back_course_id as string | null) ?? null,
    scorecardSchema: g.scorecard_schema ?? null,
    ...over,
  };
}

/** Save as the OWNER through a real authenticated JWT — the layer 179 changes. */
async function save(gameId: string, over: Record<string, unknown>) {
  const { error } = await ctx
    .authedClient("owner")
    .rpc("save_game_config", { p_trip_id: tripId, p_game_id: gameId, p_payload: await payload(gameId, over) });
  if (error) throw new Error(error.message);
}

/** One score entry — what makes `game_started` true for a stroke game. */
async function start(gameId: string) {
  const { error } = await ctx.admin.from("score_entries").insert({
    id: `se-${gameId}-1`,
    game_id: gameId,
    participant_id: ctx.user.id,
    participant_type: "user",
    unit_label: "1",
    value: 4,
  });
  if (error) throw new Error(`seed score failed: ${error.message}`);
  // The guard is only as real as the predicate it reads. Assert the view
  // actually sees this game rather than assuming the insert armed it — an
  // un-armed fixture would make every refusal case below pass vacuously.
  const { data } = await ctx.admin.from("game_started").select("game_id").eq("game_id", gameId);
  expect(data?.length, "fixture did not arm game_started").toBe(1);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("scoringType Trip");
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

describe("179 — save_game_config writes games.config", () => {
  it("persists a scoring block sent in the payload", async () => {
    const gameId = await newStrokeGame("persists");
    await save(gameId, { config: { scoringType: "stableford", stableford: STANDARD } });

    const cfg = await configOf(gameId);
    expect(cfg.scoringType).toBe("stableford");
    // The whole rubric round-trips, not just the type — the points array is the
    // part a jsonb write could plausibly flatten.
    expect(cfg.stableford).toEqual(STANDARD);
  });

  it("preserves an existing config when the payload omits the key", async () => {
    // THE `modifiers`-SHAPE CASE. Only this one separates COALESCE-PRESERVE from
    // COALESCE-to-'{}', and the wrong build is one word different.
    const gameId = await newStrokeGame("preserves");
    await save(gameId, { config: { scoringType: "stableford", stableford: BBMI_2024 } });

    await save(gameId, { name: "renamed" }); // a save that never mentions config

    const cfg = await configOf(gameId);
    expect(cfg.scoringType, "an unrelated save wiped the scoring type").toBe("stableford");
    expect(cfg.stableford).toEqual(BBMI_2024);
  });

  it("still writes an explicit change (preserve is not read-only)", async () => {
    // Guards against over-correcting the case above into a column that can be
    // set once and never changed.
    const gameId = await newStrokeGame("rewrites");
    await save(gameId, { config: { scoringType: "stableford", stableford: STANDARD } });
    await save(gameId, { config: { scoringType: "stableford", stableford: BBMI_2024 } });
    expect((await configOf(gameId)).stableford).toEqual(BBMI_2024);
  });
});

describe("179 — SCORING_TYPE_LOCKED once the game has started", () => {
  it("allows a change BEFORE any score", async () => {
    const gameId = await newStrokeGame("before");
    await save(gameId, { config: { scoringType: "stableford", stableford: STANDARD } });
    await save(gameId, { config: { scoringType: "traditional" } });
    expect((await configOf(gameId)).scoringType).toBe("traditional");
  });

  it("refuses a change once started", async () => {
    const gameId = await newStrokeGame("refuses");
    await save(gameId, { config: { scoringType: "stableford", stableford: STANDARD } });
    await start(gameId);

    await expect(
      save(gameId, { config: { scoringType: "traditional" } })
    ).rejects.toThrow(/SCORING_TYPE_LOCKED/);

    // Refused, not partially applied — the whole save is one statement.
    expect((await configOf(gameId)).scoringType).toBe("stableford");
  });

  it("refuses a RUBRIC-only change once started", async () => {
    // THE TYPE-ONLY-GUARD CASE. `scoringType` is unchanged in both payloads, so
    // a guard comparing only the type admits this — and the floor moving from
    // +2 to +3 changes where a bad hole stops costing more, which is the exact
    // property the lock exists to protect.
    const gameId = await newStrokeGame("rubric");
    await save(gameId, { config: { scoringType: "stableford", stableford: STANDARD } });
    await start(gameId);

    await expect(
      save(gameId, { config: { scoringType: "stableford", stableford: BBMI_2024 } })
    ).rejects.toThrow(/SCORING_TYPE_LOCKED/);

    expect((await configOf(gameId)).stableford).toEqual(STANDARD);
  });

  it("allows an unchanged re-send once started", async () => {
    // THE PRESENCE-GUARD CASE, and the one that keeps the app usable: every
    // settings save re-sends the whole config, so a guard keyed on the KEY
    // rather than on a changed VALUE would refuse renaming a live game.
    const gameId = await newStrokeGame("resend");
    await save(gameId, { config: { scoringType: "stableford", stableford: BBMI_2024 } });
    await start(gameId);

    await save(gameId, { name: "renamed live", config: { scoringType: "stableford", stableford: BBMI_2024 } });

    const { data } = await ctx.admin.from("games").select("name").eq("id", gameId).single();
    expect((data as { name: string }).name).toBe("renamed live");
  });

  it("allows a non-scoring config key to change once started", async () => {
    // THE WHOLE-COLUMN-GUARD CASE. `config` is general purpose; locking all of
    // it would make the next setting stored there unwritable on any live game,
    // and the refusal would name scoring — an error pointing at the wrong
    // object, which is the failure CLAUDE.md's refusal rule is about.
    const gameId = await newStrokeGame("narrow");
    await save(gameId, { config: { scoringType: "stableford", stableford: BBMI_2024, somethingElse: 1 } });
    await start(gameId);

    await save(gameId, { config: { scoringType: "stableford", stableford: BBMI_2024, somethingElse: 2 } });

    expect((await configOf(gameId)).somethingElse).toBe(2);
  });
});
