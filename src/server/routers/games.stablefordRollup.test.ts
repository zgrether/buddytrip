import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { STABLEFORD_PRESETS } from "@/lib/stableford";
import { STROKE_PLAY_UNITS } from "@/lib/strokePlayConfig";

/**
 * A STABLEFORD GAME RANKS THE HIGHEST TOTAL FIRST — through the banked
 * `game_results` and the competition roll-up, not only the game leaderboard.
 *
 * This is the spec's first required test and the one #1245 is the precedent
 * for. That bug was not in any scoring engine: the roll-up collapsed two fields
 * with opposite conventions into one number, so a team that won 35 read as
 * "position 35" and the cup went to the side that lost every match. Every step
 * was plausible. Only an assertion downstream of the write catches it.
 *
 * ── The fixture is the whole test ──────────────────────────────────────────
 *
 * TRADITIONAL AND STABLEFORD PICK OPPOSITE WINNERS HERE, deliberately. A
 * fixture where the better card also has the better points cannot tell a
 * direction-blind build from a correct one — it passes against both. (Learned
 * one layer down: a leaderboard mutant survived exactly that mistake.)
 *
 *   steady — 18 pars                       → 72 strokes, 72 points
 *   spiky  — 4 birdies, 13 pars, one 14    → 78 strokes, 76 points
 *
 * `steady` has the better round by strokes and LOSES on points, because four
 * birdies pay 6 apiece while the blow-up stops costing at the floor. So:
 *
 *   · a build that ranks Stableford low-wins gives the cup to `steady`
 *   · a build that never applies the rubric at all gives it to `steady`
 *   · only a correct build gives it to `spiky`
 *
 * ── Why the config is written with the admin client ────────────────────────
 *
 * The question here is "given a game whose config says Stableford, does
 * finalize rank and bank correctly". Whether `save_game_config` can WRITE that
 * config is migration 179's question and is tested in
 * `games.saveConfig.scoringType.test.ts`. Writing it directly keeps this test
 * pointed at the computation rather than at the settings path, and keeps it
 * passing whether or not the tRPC layer has learned to forward the key yet.
 *
 * Scores are inserted with the admin client in one statement rather than
 * through 36 `scores.upsertEntry` calls. The row shape is copied from that
 * procedure exactly — same deterministic id, same columns — because the thing
 * under test reads `score_entries` and nothing else about how they arrived.
 */

const STROKE = "gtt_stroke_play";
const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;

let ctx: TestContext;
let tripId: string;
let owner: string;
let member: string;
const gameIds: string[] = [];
const compIds: string[] = [];

/** The default 18-unit stroke schema's pars — what a course-less game scores on. */
const PARS = STROKE_PLAY_UNITS.map((u) => u.par as number);

/**
 * `steady` shoots par on every hole. `spiky` birdies the first four, pars the
 * next thirteen, and takes a 14 on the last.
 */
function cardFor(who: "steady" | "spiky"): number[] {
  if (who === "steady") return PARS.slice();
  return PARS.map((par, i) => {
    if (i < 4) return par - 1; // birdie
    if (i === 17) return par + 10; // the blow-up
    return par; // par
  });
}

async function insertCard(gameId: string, participantId: string, card: number[]) {
  const rows = card.map((value, i) => ({
    id: `${gameId}:${participantId}:${i + 1}`,
    game_id: gameId,
    participant_id: participantId,
    participant_type: "user",
    unit_label: String(i + 1),
    value,
    submitted_by: participantId,
    submitted_at: new Date().toISOString(),
  }));
  const { error } = await ctx.admin.from("score_entries").upsert(rows, {
    onConflict: "game_id,participant_id,unit_label",
  });
  if (error) throw new Error(`seed scores failed: ${error.message}`);
}

/** A two-team cup with one stroke game, both players rostered and grouped. */
async function fixture(name: string, scoringConfig: Record<string, unknown>) {
  const competitionId = await ctx.createCompetition(tripId, `${name} Cup`);
  compIds.push(competitionId);

  const teamA = await ctx.createTeam(competitionId, "Steady", { color: "#ff0000" });
  const teamB = await ctx.createTeam(competitionId, "Spiky", { color: "#00ff00" });
  // Error-checked, because a silent failure here empties `teamOf` and the
  // finalize writes NO team rows — which surfaces as "the assertion found
  // nothing" three screens away rather than as "the seed failed".
  // No `id` column — the PK is (competition_id, user_id).
  const { error: taErr } = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, team_id: teamA, user_id: owner },
    { competition_id: competitionId, team_id: teamB, user_id: member },
  ]);
  if (taErr) throw new Error(`team_assignments seed failed: ${taErr.message}`);

  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: STROKE,
    name,
    competitionId,
  })) as { id: string };
  gameIds.push(g.id);

  const hash = (await ctx.caller().games.configHash({ tripId, gameId: g.id })).hash;
  await ctx.caller().games.saveConfig({
    tripId,
    gameId: g.id,
    baseHash: hash,
    payload: {
      name,
      rulesForToday: null,
      scoringEnabled: true,
      pointsTotal: 10,
      // `type`, not `kind` — the discriminator `isPlacement` reads. Getting it
      // wrong makes the game fall into the unknown-shape branch and award
      // NOTHING, which reads as a direction bug rather than a fixture bug.
      pointsDistribution: { type: "placement", values: [10, 0] },
      modifiers: {},
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      groups: [{ name: "G1", userIds: [owner, member] }],
      groupsStructureDirty: true,
    },
  });

  // The scoring type. See the header for why this is written directly.
  const { error } = await ctx.admin.from("games").update({ config: scoringConfig }).eq("id", g.id);
  if (error) throw new Error(`config write failed: ${error.message}`);

  await insertCard(g.id, owner, cardFor("steady"));
  await insertCard(g.id, member, cardFor("spiky"));
  return { gameId: g.id, competitionId, teamA, teamB };
}

async function resultsOfType(gameId: string, entityType: "team" | "user") {
  const { data } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, raw_score, position")
    .eq("game_id", gameId)
    .eq("entity_type", entityType);
  return (data ?? []) as { entity_id: string; raw_score: number; position: number }[];
}
const teamResults = (gameId: string) => resultsOfType(gameId, "team");
const userResults = (gameId: string) => resultsOfType(gameId, "user");

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Stableford rollup Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("score_entries").delete().in("game_id", gameIds);
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("game_participants").delete().in("game_id", gameIds);
    await ctx.admin.from("play_groups").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("the fixture makes the two formats disagree", () => {
  it("spiky shoots MORE strokes and scores MORE points", () => {
    const steady = cardFor("steady");
    const spiky = cardFor("spiky");
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    // If this ever stops being true the tests below stop distinguishing the
    // builds they exist to separate, and would pass against a wrong one.
    expect(sum(steady)).toBe(72);
    expect(sum(spiky)).toBe(78);
    expect(sum(spiky)).toBeGreaterThan(sum(steady));

    const pts = (card: number[]) =>
      card.reduce((acc, v, i) => {
        const d = Math.min(Math.max(v - PARS[i], BBMI.ceiling), BBMI.floor);
        return acc + BBMI.points[d - BBMI.ceiling];
      }, 0);
    expect(pts(steady)).toBe(72);
    expect(pts(spiky)).toBe(76);
    expect(pts(spiky)).toBeGreaterThan(pts(steady));
  });
});

describe("STABLEFORD — the banked result and the cup", () => {
  it("banks position 1 for the HIGHER points total, and pays that team", async () => {
    const { gameId, competitionId, teamA, teamB } = await fixture("SF", {
      scoringType: "stableford",
      stableford: { preset: "bbmi_2024", ...BBMI },
    });

    await ctx.caller().games.finish({ tripId, gameId });

    // ── The banked rows ────────────────────────────────────────────────────
    const rows = await teamResults(gameId);
    const spikyRow = rows.find((r) => r.entity_id === teamB)!;
    const steadyRow = rows.find((r) => r.entity_id === teamA)!;

    // `raw_score` is POINTS under Stableford, not strokes.
    expect(spikyRow.raw_score).toBe(76);
    expect(steadyRow.raw_score).toBe(72);
    // And the direction: more points is FIRST. A low-wins build banks these the
    // other way round, and everything downstream inherits it.
    expect(spikyRow.position).toBe(1);
    expect(steadyRow.position).toBe(2);

    // ── The roll-up ────────────────────────────────────────────────────────
    // Where #1245 actually hid. The leaderboard ranks `position ?? raw_score`,
    // so a wrong position here is a wrong cup, and a diff never shows it.
    const board = (await ctx.caller().competitions.leaderboard({
      tripId,
      competitionId,
    })) as { teamTotals: Record<string, number> };

    const pointsFor = (id: string) => board.teamTotals[id] ?? 0;
    expect(pointsFor(teamB)).toBe(10); // the [10, 0] placement split
    expect(pointsFor(teamA)).toBe(0);
    expect(pointsFor(teamB)).toBeGreaterThan(pointsFor(teamA));
  });

  it("banks the PER-PLAYER rows the right way up too", async () => {
    /**
     * A SEPARATE ASSERTION, and not a redundant one — found by mutation.
     *
     * `computeStrokeTeamStandings` reads each standing's `rawScore` and never
     * its `position`, so ranking the PLAYER standings the wrong way leaves the
     * team rows and the whole cup correct. A test that stopped at the team rows
     * passed against that build.
     *
     * The user rows are not decoration: `loadSummaryEntries` reads them to
     * write the finish notification, so the mutant ships a push naming the
     * wrong winner while the board pays the right team — two surfaces
     * disagreeing about one game, with nothing on screen to reconcile them.
     */
    const { gameId } = await fixture("SFU", {
      scoringType: "stableford",
      stableford: { preset: "bbmi_2024", ...BBMI },
    });

    await ctx.caller().games.finish({ tripId, gameId });

    const rows = await userResults(gameId);
    const spiky = rows.find((r) => r.entity_id === member)!;
    const steady = rows.find((r) => r.entity_id === owner)!;

    expect(spiky.raw_score).toBe(76);
    expect(steady.raw_score).toBe(72);
    expect(spiky.position).toBe(1);
    expect(steady.position).toBe(2);
  });
});

describe("TRADITIONAL is unchanged — the constraint the timing rests on", () => {
  it("the SAME two cards bank the opposite winner with no scoring config", async () => {
    // Byte-identity asserted where it matters: same fixture, same finalize, and
    // the result is today's behaviour. That this is the OPPOSITE of the case
    // above is what proves the config is being read at all — if it were
    // ignored, one of the two tests would have to fail.
    const { gameId, competitionId, teamA, teamB } = await fixture("TRAD", {});

    await ctx.caller().games.finish({ tripId, gameId });

    const rows = await teamResults(gameId);
    const steadyRow = rows.find((r) => r.entity_id === teamA)!;
    const spikyRow = rows.find((r) => r.entity_id === teamB)!;

    // `raw_score` is STROKES here, and lowest wins.
    expect(steadyRow.raw_score).toBe(72);
    expect(spikyRow.raw_score).toBe(78);
    expect(steadyRow.position).toBe(1);
    expect(spikyRow.position).toBe(2);

    const board = (await ctx.caller().competitions.leaderboard({
      tripId,
      competitionId,
    })) as { teamTotals: Record<string, number> };
    const pointsFor = (id: string) => board.teamTotals[id] ?? 0;
    expect(pointsFor(teamA)).toBe(10);
    expect(pointsFor(teamB)).toBe(0);
  });

  it("a MALFORMED rubric falls back to Traditional rather than scoring NaN", async () => {
    // `config` is jsonb and no type system reaches it. A short `points` array
    // would index past its end and total to NaN, which banks a result nobody
    // can read. Falling back scores the round exactly as it always did.
    const { gameId, teamA, teamB } = await fixture("BAD", {
      scoringType: "stableford",
      stableford: { ceiling: -2, floor: 3, points: [9, 6] },
    });

    await ctx.caller().games.finish({ tripId, gameId });

    const rows = await teamResults(gameId);
    expect(rows.every((r) => Number.isFinite(r.raw_score))).toBe(true);
    expect(rows.find((r) => r.entity_id === teamA)!.position).toBe(1);
    expect(rows.find((r) => r.entity_id === teamB)!.raw_score).toBe(78);
  });
});
