import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { computeCompetitionLeaderboard } from "../lib/competitionLeaderboard";
import { isNew } from "../lib/gameReadiness";

/**
 * NEW vs CONFIGURING — the behavioural half.
 *
 * `gameStateCoverage.test.ts` asserts the classification is total and that the
 * leaderboard's select carries it. This asserts the answers, through the REAL
 * read path (`computeCompetitionLeaderboard`) rather than the pure predicate, so
 * a select that stops carrying a column fails here too.
 *
 * The two motivating defects each get a test, because they are what the change
 * exists to fix and a suite that only checks fresh-and-configured would have
 * passed before it:
 *   • a non-golf game read CONFIGURING at the instant of creation
 *   • a bracket game with seeded entrants read NEW
 */

const STROKE_PLAY = "gtt_stroke_play";
const MATCH_PLAY = "gtt_match_play";
const NON_GOLF = "gtt_generic_card";

describe("isNew — New vs Configuring", () => {
  let ctx: TestContext;
  let tripId: string;
  let competitionId: string;
  const createdCourses: string[] = [];

  /** The board's answer for one game, read the way the board reads it. */
  async function sectionInputs(gameId: string) {
    const lb = await computeCompetitionLeaderboard(ctx.admin, competitionId);
    const g = lb.games.find((x) => x.id === gameId);
    expect(g, `game ${gameId} missing from the leaderboard payload`).toBeTruthy();
    return g!;
  }

  /**
   * Create a game with EXACTLY the payload the add-game modal sends
   * (CompetitionGamesPanel.persist) — including the #503 zero-points sentinel.
   * Using the real payload is the point: a test that created a game with no
   * points at all would never exercise the sentinel, which is the whole reason
   * `hasPoints` fails as a signal.
   */
  async function addGameAsModalDoes(gameTypeId: string, name: string) {
    const isMatch = gameTypeId === MATCH_PLAY;
    const g = await ctx.caller().games.create({
      tripId,
      gameTypeId,
      name,
      competitionId,
      pointsDistribution: isMatch ? { type: "per_match", value: 0 } : null,
      pointsTotal: isMatch ? null : 0,
    });
    return g.id as string;
  }

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("New-state split");
    // Sequentially, never Promise.all (CLAUDE.md local-stack conventions).
    await ctx.addTripMember(tripId, "member");
    competitionId = await ctx.createCompetition(tripId, "New-state cup");
  });

  afterAll(async () => {
    if (createdCourses.length) await ctx.admin.from("courses").delete().in("id", createdCourses);
    await ctx.cleanup();
  });

  // ── 1 · fresh → New ────────────────────────────────────────────────────────

  it("a freshly created game is New", async () => {
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Fresh stroke");
    const g = await sectionInputs(gameId);
    expect(g.isNewGame).toBe(true);
  });

  it("a freshly created NON-GOLF game is New — it never could be before", async () => {
    // The first defect. `isConfigured` falls through to `hasPoints` for manual
    // formats, and the modal always writes the sentinel, so this game was
    // `configured === true` at creation and landed in Configuring immediately.
    // Both facts are asserted, not just the new answer: if `configured` stopped
    // being true here the test would still pass on `isNewGame` alone while no
    // longer exercising the defect at all.
    const gameId = await addGameAsModalDoes(NON_GOLF, "Fresh non-golf");
    const g = await sectionInputs(gameId);
    expect(g.configured, "the old predicate still says configured — the defect is real").toBe(true);
    expect(g.isNewGame, "but nothing has been configured").toBe(true);
  });

  // ── 2 · one config field → Configuring ─────────────────────────────────────

  /**
   * Table-driven over the config columns a settings save can write, each set to a
   * REAL value of its own kind. One row per column means a column dropped from
   * `CONFIG_COL_DEPARTED` fails here as well as in the coverage guard — the
   * coverage guard would still pass if someone deleted a column from the record
   * AND from `GAME_CONFIG_COLS`, which this does not.
   */
  const ONE_FIELD: [string, unknown][] = [
    ["tee_time", "08:30"],
    ["rules_for_today", "Play it as it lies"],
    ["course_id", null], // replaced below — course needs a real row
    ["back_course_id", null],
    ["modifiers", { glorious_holes: { holes: 3 } }],
    ["config", { some_setting: true }],
    ["bracket_config", { seeding: "manual", entrants: "singles" }],
    ["entry_mode", "outcome"],
    ["competition_format", "bracket"],
    ["scorecard_schema", { units: { count: 18, labels: [], metadata: {} } }],
    ["points_total", 12],
    ["points_distribution", { type: "placement", values: [6, 4, 2] }],
  ];

  it.each(ONE_FIELD.filter(([c]) => c !== "course_id" && c !== "back_course_id"))(
    "one config field (%s) moves a game out of New",
    async (col, value) => {
      const gameId = await addGameAsModalDoes(STROKE_PLAY, `One field ${col}`);
      expect((await sectionInputs(gameId)).isNewGame, "precondition: starts New").toBe(true);

      await ctx.admin.from("games").update({ [col]: value }).eq("id", gameId);
      const g = await sectionInputs(gameId);
      expect(g.isNewGame, `${col} was written but the game still reads New`).toBe(false);
    }
  );

  it("the zero points sentinel does NOT move a game out of New", async () => {
    // The inverse of the row above, and the reason `points_total` needs a
    // positive-value predicate rather than a null check. Asserted as a real write
    // of the same values the modal sends, so it fails if someone "simplifies"
    // `CONFIG_COL_DEPARTED` back to `v != null`.
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Zero points");
    await ctx.admin.from("games").update({ points_total: 0 }).eq("id", gameId);
    expect((await sectionInputs(gameId)).isNewGame).toBe(true);

    const matchId = await addGameAsModalDoes(MATCH_PLAY, "Zero per-match");
    await ctx.admin
      .from("games")
      .update({ points_distribution: { type: "per_match", value: 0 } })
      .eq("id", matchId);
    expect((await sectionInputs(matchId)).isNewGame).toBe(true);
  });

  it("a configured-but-rosterless GOLF game is Configuring — it read New before", async () => {
    // The real second defect, replacing a claim about brackets that measurement
    // disproved. Stroke is a ROSTER_TYPE, so `isConfigured` gates on participants
    // and ignores everything else: a game with a tee time and a real point value
    // but no roster was `configured === false` and sat under "New".
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Half-built");
    await ctx.admin
      .from("games")
      .update({ tee_time: "08:30", points_total: 8 })
      .eq("id", gameId);

    const g = await sectionInputs(gameId);
    expect(g.configured, "the old predicate still says NOT configured — the defect is real").toBe(false);
    expect(g.isNewGame, "but a tee time and 8 points are configuration").toBe(false);
  });

  it("a child row alone moves a game out of New", async () => {
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Roster only");
    expect((await sectionInputs(gameId)).isNewGame).toBe(true);
    // ≥2 players — a stroke game with one participant isn't a game.
    await ctx.caller().games.addParticipants({
      tripId,
      gameId,
      userIds: [ctx.user.id, ctx.getUser("member").id],
    });
    const g = await sectionInputs(gameId);
    expect(g.isNewGame, "a participant is a configuration act").toBe(false);
    // Still not READY — the roster exists but is ungrouped (mig 089). This is the
    // state the old predicate had no way to name: not New, not Ready.
    expect(g.configured, "ungrouped roster is not Ready").toBe(false);
  });

  // ── 3 · complete → Ready (never New) ───────────────────────────────────────

  it("a game past pending is never New, however little was configured", async () => {
    // `isNew` short-circuits on status. Asserted with a game that would ANSWER
    // New on its columns alone, so the short-circuit is what is being tested
    // rather than the column check happening to agree.
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Straight to active");
    expect(isNew({ ...(await rawRow(gameId)) }, 0), "columns alone say New").toBe(true);

    await ctx.admin.from("games").update({ status: "active" }).eq("id", gameId);
    expect((await sectionInputs(gameId)).isNewGame).toBe(false);

    await ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId);
    expect((await sectionInputs(gameId)).isNewGame).toBe(false);
  });

  async function rawRow(gameId: string): Promise<Record<string, unknown>> {
    const { data } = await ctx.admin.from("games").select("*").eq("id", gameId).single();
    return data as Record<string, unknown>;
  }

  // ── 4 · loses configuration → Configuring, NOT New ─────────────────────────

  it("a game that had a course and lost it reads Configuring, on scorecard_schema", async () => {
    /**
     * The test flagged up front as the one most likely to be decorative — "it
     * lost its configuration so it must differ from a fresh game somehow" is an
     * assumption, not an assertion. So it names the SPECIFIC column that still
     * carries the departure and proves the others do not:
     *
     *   `games.clearCourse` nulls `course_id` AND `back_course_id`, and sets
     *   `scorecard_schema` to the FORMAT'S BASE SCHEMA — non-null for the three
     *   golf formats. That one column is the entire reason this game does not
     *   read New, and if `scorecard_schema` were dropped from the predicate or
     *   from the leaderboard's select, this game would read New again.
     *
     * Asserting only `isNewGame === false` would pass on any of the three
     * columns, including on a `course_id` that had NOT been cleared — i.e. it
     * would pass if `clearCourse` were broken.
     */
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Course then cleared");
    const course = await ctx.caller().courses.create({
      name: `Cleared course ${Date.now()}`,
      holeCount: 18,
      par: Array(18).fill(4),
      handicapIndex: Array.from({ length: 18 }, (_, i) => i + 1),
      hasStrokeIndex: true,
      teeSets: [{ name: "White", yards: Array(18).fill(350) }],
      source: "manual",
    });
    createdCourses.push(course.id as string);

    await ctx.caller().games.applyCourse({ tripId, gameId, courseId: course.id as string });
    expect((await sectionInputs(gameId)).isNewGame, "a course was applied").toBe(false);

    await ctx.caller().games.clearCourse({ tripId, gameId });
    const row = await rawRow(gameId);

    // The course columns really did go back to their creation value — so this is
    // genuinely the "lost its configuration" state and not a half-cleared one.
    expect(row.course_id, "course_id returned to null").toBeNull();
    expect(row.back_course_id, "back_course_id returned to null").toBeNull();
    // And THIS is what still says the game was configured.
    expect(row.scorecard_schema, "the base schema survives clearCourse").not.toBeNull();

    const g = await sectionInputs(gameId);
    expect(g.isNewGame, "a game that lost a course is Configuring, not New").toBe(false);

    // The mechanism, pinned: with scorecard_schema back at its creation value the
    // game WOULD read New — which is what makes the assertion above about that
    // column rather than about a vague residue.
    expect(isNew({ ...row, scorecard_schema: null }, 0)).toBe(true);
  });

  // ── The bracket case ───────────────────────────────────────────────────────

  it("a bracket game with seeded entrants is Configuring — as it already was", async () => {
    /**
     * NOT a defect this change fixes, and the name says so because the first
     * version of this test claimed it was.
     *
     * The claim was that a seeded bracket read "New", reasoning that
     * `isConfigured` is roster-gated and a bracket has no `game_participants`.
     * Measuring a staged board disproved it: a bracket is not a ROSTER_TYPE
     * either, so it falls to the `hasPoints` arm, and the add-game modal's points
     * sentinel makes that true — it always read Configuring. The section is
     * unchanged.
     *
     * Kept anyway, because the ANSWER still has to hold for the new predicate and
     * for a different reason than before: it is now the entrants that carry it,
     * not the points sentinel. The control below is what pins that.
     */
    const gameId = await addGameAsModalDoes(NON_GOLF, "Bracket field");
    await ctx.admin
      .from("games")
      .update({ competition_format: "bracket" })
      .eq("id", gameId);

    const entrants = Array.from({ length: 4 }, (_, i) => ({
      id: `${gameId}:e${i + 1}`,
      game_id: gameId,
      seed: i + 1,
      team_id: null,
    }));
    await ctx.admin.from("bracket_entrants").insert(entrants);

    const g = await sectionInputs(gameId);
    expect(g.isNewGame, "a seeded field is configuration").toBe(false);

    // And the entrants are what carry it — not `competition_format`, which the
    // line above also wrote. Proven by asking the predicate with the row's
    // format reset but the entrant count intact.
    const row = await rawRow(gameId);
    expect(isNew({ ...row, competition_format: null }, entrants.length)).toBe(false);
    expect(
      isNew({ ...row, competition_format: null }, 0),
      "control: with neither signal it would read New"
    ).toBe(true);
  });

  // ── A KNOWN DIVERGENCE, pinned so it is recorded rather than accidental ────

  it("a game reset to skeleton reads CONFIGURING, not New — two definitions disagree", async () => {
    /**
     * ⚠ UNRESOLVED CONFLICT, deliberately not resolved here.
     *
     * Migration 125 defines reset level 2's target state as "as newly added" and
     * classifies `points_total` as IDENTITY — it survives the reset, and the UI
     * promises "the name and point value are kept". This module classifies a
     * POSITIVE `points_total` as CONFIG (a value can only become positive via the
     * settings page).
     *
     * Both are defensible and they disagree about the same column, so a game
     * reset to "New" does not read New on the board. CLAUDE.md says to flag a
     * document conflict rather than silently resolve it, so this test records the
     * behaviour that ships instead of asserting the one that ought to be right.
     *
     * Filed separately. If the resolution is "points_total is identity", move the
     * two points entries out of `CONFIG_COL_DEPARTED` into `IDENTITY_COLS` — the
     * coverage guard keeps the partition total either way — and this test flips to
     * expecting `true`. Note that doing so also retires the property that a New
     * game always shows `—` in the points column: after a reset it would show its
     * kept value.
     */
    const gameId = await addGameAsModalDoes(NON_GOLF, "Reset to skeleton");
    await ctx.admin
      .from("games")
      .update({ points_total: 12, tee_time: "09:00", status: "complete" })
      .eq("id", gameId);
    const { error } = await ctx.admin.rpc("_reset_game_to_skeleton", { p_game_id: gameId });
    expect(error, "the reset itself must succeed").toBeNull();

    const row = await rawRow(gameId);
    // The reset did what it promises: back to pending, config cleared, value kept.
    expect(row.status).toBe("pending");
    expect(row.tee_time, "config cleared").toBeNull();
    expect(row.points_total, "the point value is kept — migration 125's promise").toBe(12);

    const g = await sectionInputs(gameId);
    expect(
      g.isNewGame,
      "PINNED, not endorsed: the kept point value is what holds this out of New"
    ).toBe(false);
    // And it is ONLY the point value — every other column is back at creation.
    expect(isNew({ ...row, points_total: 0 }, 0), "with points at 0 it reads New").toBe(true);
  });

  // ── The fail-safe ──────────────────────────────────────────────────────────

  it("a row missing a config column reads NOT New, never New", async () => {
    // The direction matters: an unseen column must degrade to the old answer
    // (Configuring), not silently claim the game is untouched. This is the
    // behaviour `gameStateCoverage.test.ts` exists to keep from ever mattering.
    const gameId = await addGameAsModalDoes(STROKE_PLAY, "Fail-safe");
    const row = await rawRow(gameId);
    expect(isNew(row, 0), "the complete row reads New").toBe(true);

    const partial = { ...row };
    delete partial.modifiers;
    expect(isNew(partial, 0), "a missing column must not read as untouched").toBe(false);
  });
});
