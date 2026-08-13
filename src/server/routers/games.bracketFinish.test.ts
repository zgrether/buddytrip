import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildDraw } from "../../lib/bracket";

/**
 * The bracket's finalize, end to end — spec item 6.
 *
 * "The bracket produces placements matching the distribution, and the points land
 * on the right teams. **Verify in the database, not the UI** — that distinction is
 * the lesson of every scoring bug in this project."
 *
 * So every assertion below reads either `game_results` directly or
 * `competitions.leaderboard`, which is the server roll-up. Nothing here renders
 * anything. `bracketPlacements.test.ts` already pins the pure rule; this pins that
 * the rule reaches the database in one piece and comes back out as team points —
 * the two seams a pure test cannot cover.
 *
 * The write and the read are deliberately in ONE file, because together they are
 * the claim. A test proving entrant rows exist and a separate test proving the
 * leaderboard sums entrant rows can both pass while the finalize writes rows the
 * leaderboard never looks at — which is precisely the failure migration 119's
 * header warns about.
 *
 * ── Cup isolation ───────────────────────────────────────────────────────────
 * `teamTotals` sums every game in a competition, so each roll-up test builds its
 * OWN cup and teams. Sharing one would make each assertion depend on which tests
 * ran before it — the same reasoning behind the suite's unique-trip discipline,
 * one level down.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];
const compIds: string[] = [];

interface Entrant {
  seed: number;
  teamId: string | null;
  userIds: string[];
}

interface Cup {
  competitionId: string;
  teamA: string;
  teamB: string;
}

/** A fresh competition with two teams. Sequential, never `Promise.all` — the
 *  seed helpers race (CLAUDE.md's local-stack conventions). */
async function newCup(name: string): Promise<Cup> {
  const competitionId = await ctx.createCompetition(tripId, name);
  compIds.push(competitionId);
  const teamA = await ctx.createTeam(competitionId, "Manhattans");
  const teamB = await ctx.createTeam(competitionId, "Centurions");
  return { competitionId, teamA, teamB };
}

async function newBracket(
  cup: Cup,
  name: string,
  entrants: Entrant[],
  opts: { distribution?: number[]; pointsTotal?: number; consolation?: boolean } = {}
): Promise<string> {
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: CARD, name, competitionId: cup.competitionId,
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
      pointsTotal: opts.pointsTotal ?? 8,
      pointsDistribution: opts.distribution ? { type: "placement" as const, values: opts.distribution } : null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: "bracket" as const,
      bracketConfig: {
        elimination: "single" as const,
        entrants: "singles" as const,
        seeding: "manual" as const,
        consolation: opts.consolation ?? false,
      },
      bracketEntrants: entrants,
      bracketDraw: buildDraw(entrants.length, { consolation: opts.consolation ?? false }),
    },
  });
  return g.id;
}

const pick = (gameId: string, round: number, slot: number, winnerSeed: number | null, bracket: "main" | "consolation" = "main") =>
  ctx.caller().games.pickWinner({ tripId, gameId, bracket, round, slot, winnerSeed });

/** `game_results` as the database holds it, ordered by finishing position. */
async function resultsOf(gameId: string) {
  const { data } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, position, raw_score")
    .eq("game_id", gameId)
    .order("position", { ascending: true });
  return (data ?? []) as { entity_id: string; entity_type: string; position: number; raw_score: number }[];
}

/** The deterministic entrant id (migration 115) — what `entity_id` should hold. */
const entrantId = (gameId: string, seed: number) => `${gameId}:e${seed}`;

const board = (cup: Cup) => ctx.caller().competitions.leaderboard({ tripId, competitionId: cup.competitionId });

/** Four entrants, alternating teams: seeds 1+3 are A, 2+4 are B. */
const fourSplit = (cup: Cup): Entrant[] => [
  { seed: 1, teamId: cup.teamA, userIds: [owner] },
  { seed: 2, teamId: cup.teamB, userIds: [planner] },
  { seed: 3, teamId: cup.teamA, userIds: [member] },
  { seed: 4, teamId: cup.teamB, userIds: [outsider] },
];

/**
 * Play a 4-draw to chalk. `buildDraw(4)` pairs 1v4 and 2v3, so seed 1 takes it,
 * seed 2 is runner-up, and seeds 3 and 4 tie at 3rd — elimination round IS the
 * ranking (#916), which is what makes the tie a real result rather than a gap.
 */
async function playChalk4(gameId: string) {
  await pick(gameId, 1, 1, 1);
  await pick(gameId, 1, 2, 2);
  await pick(gameId, 2, 1, 1);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("bracket finish Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("bracket_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("bracket_entrants").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("games.finish — the bracket arm writes ENTRANT placements", () => {
  let cup: Cup;
  beforeAll(async () => {
    // These read `game_results` per game, so one cup is enough — nothing here
    // depends on a competition-wide total.
    cup = await newCup("bracket write Cup");
  });

  it("records every entrant's place, as entity_type 'entrant'", async () => {
    const gameId = await newBracket(cup, "Chalk", fourSplit(cup), { distribution: [4, 2, 1, 1] });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    const rows = await resultsOf(gameId);
    // Every entrant is placed — storage, not a mandate (migration 119).
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.entity_type === "entrant")).toBe(true);
    // NOT a team row anywhere: a bracket's competitors are entrants, and a stray
    // team row would be picked up by the leaderboard's OTHER branch and awarded
    // a second time.
    expect(rows.some((r) => r.entity_type === "team")).toBe(false);

    expect(rows[0]).toMatchObject({ entity_id: entrantId(gameId, 1), position: 1 });
    expect(rows[1]).toMatchObject({ entity_id: entrantId(gameId, 2), position: 2 });
    // Seeds 3 and 4 lost in round 1, so they TIE at 3rd. Both carry position 3;
    // nobody carries 4 — the tie group spans 3rd–4th and the distribution
    // averages it, rather than the record inventing an order.
    const tied = rows.filter((r) => r.position === 3).map((r) => r.entity_id).sort();
    expect(tied).toEqual([entrantId(gameId, 3), entrantId(gameId, 4)].sort());
    expect(rows.some((r) => r.position === 4)).toBe(false);

    // raw_score mirrors position for low_wins, as the entered-order arm does.
    expect(rows.every((r) => r.raw_score === r.position)).toBe(true);
  });

  it("locks the game the same way every other format does", async () => {
    const gameId = await newBracket(cup, "Lock", fourSplit(cup), { distribution: [4, 2, 1, 1] });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    const { data: row } = await ctx.admin
      .from("games")
      .select("status, corrections_open, scoring_enabled")
      .eq("id", gameId)
      .maybeSingle();
    expect(row).toMatchObject({ status: "complete", corrections_open: false, scoring_enabled: true });
  });

  it("is idempotent — re-finalizing replaces rather than duplicates", async () => {
    const gameId = await newBracket(cup, "Rerun", fourSplit(cup), { distribution: [4, 2, 1, 1] });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });
    await ctx.caller().games.finish({ tripId, gameId });
    expect(await resultsOf(gameId)).toHaveLength(4);
  });

  /**
   * A CONSOLATION match splits the tie it was added to split, and the proof has to
   * be in the rows — that difference exists nowhere else. It changes what the
   * bracket can TELL APART, never what it pays.
   */
  it("with a consolation match, 3rd and 4th are real places", async () => {
    const gameId = await newBracket(cup, "Playoff", fourSplit(cup), { distribution: [4, 2, 1, 1], consolation: true });
    await playChalk4(gameId);
    // The semi losers are seeds 4 (lost to 1) and 3 (lost to 2). Seed 4 wins the
    // play-off, so it takes 3rd and seed 3 takes 4th. The play-off sits in the
    // FINAL's round — it is played alongside it (`buildDraw`).
    await pick(gameId, 2, 1, 4, "consolation");
    await ctx.caller().games.finish({ tripId, gameId });

    const rows = await resultsOf(gameId);
    expect(rows).toHaveLength(4);
    const posOf = (seed: number) => rows.find((r) => r.entity_id === entrantId(gameId, seed))!.position;
    expect(posOf(1)).toBe(1);
    expect(posOf(2)).toBe(2);
    expect(posOf(4)).toBe(3);
    expect(posOf(3)).toBe(4);
  });
});

describe("games.finish — what the bracket arm REFUSES", () => {
  let cup: Cup;
  beforeAll(async () => {
    cup = await newCup("bracket refusal Cup");
  });

  it("an undecided draw is refused, and nothing is written", async () => {
    const gameId = await newBracket(cup, "Half played", fourSplit(cup), { distribution: [4, 2, 1, 1] });
    await pick(gameId, 1, 1, 1); // one match decided, the final still open

    await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // The refusal fires before any write — and, critically, the game stays
    // finishable rather than locking complete with an empty results table, which
    // is the #776 failure applied to a new arm.
    expect(await resultsOf(gameId)).toHaveLength(0);
    const { data: row } = await ctx.admin.from("games").select("status").eq("id", gameId).maybeSingle();
    expect((row as { status: string }).status).not.toBe("complete");
  });

  it("a bracket with no draw at all is refused rather than posted empty", async () => {
    // Migration 117 stops such a game going live; this is the read-side
    // counterpart for one that somehow did.
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: CARD, name: "Empty bracket", competitionId: cup.competitionId,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin.from("games").update({ competition_format: "bracket" }).eq("id", g.id);

    await expect(ctx.caller().games.finish({ tripId, gameId: g.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(await resultsOf(g.id)).toHaveLength(0);
  });

  /**
   * `placements` is the MANUAL arm's input. A bracket derives its own, so a passed
   * order must not reach the write — accepting one would be a second answer to who
   * won a tree the server can already read.
   */
  it("IGNORES a passed placements array rather than committing it", async () => {
    const gameId = await newBracket(cup, "Ignore", fourSplit(cup), { distribution: [4, 2, 1, 1] });
    await playChalk4(gameId);
    await ctx.caller().games.finish({
      tripId,
      gameId,
      placements: [{ entityId: "should-not-appear", position: 1 }],
    });

    const rows = await resultsOf(gameId);
    expect(rows.map((r) => r.entity_id)).not.toContain("should-not-appear");
    expect(rows.every((r) => r.entity_type === "entrant")).toBe(true);
    // The DERIVED order won, not the passed one.
    expect(rows[0].entity_id).toBe(entrantId(gameId, 1));
  });

  /**
   * The legacy descriptors are read-accepted (migration 114) but must NOT route to
   * the bracket engine: they predate the schema, so they have no entrants and no
   * draw, and routing them there would make a game that finalizes by hand today
   * unfinishable. `resolveResultStrategy` says so; this proves the server agrees.
   */
  it("a legacy bracket_se game still finalizes by the entered-order arm", async () => {
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: CARD, name: "Legacy SE", competitionId: cup.competitionId,
    })) as { id: string };
    gameIds.push(g.id);
    await ctx.admin.from("games").update({ competition_format: "bracket_se" }).eq("id", g.id);

    await ctx.caller().games.finish({
      tripId,
      gameId: g.id,
      placements: [
        { entityId: cup.teamA, position: 1 },
        { entityId: cup.teamB, position: 2 },
      ],
    });

    const rows = await resultsOf(g.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.entity_type === "team")).toBe(true);
    expect(rows[0]).toMatchObject({ entity_id: cup.teamA, position: 1 });
  });
});

/**
 * ── Spec item 6 proper: the points land on the RIGHT TEAMS ──────────────────
 *
 * Read through `competitions.leaderboard` — the server roll-up, and the same
 * payload the board renders from, asserted before anything renders it.
 */
describe("the leaderboard rolls entrant placements up to cup teams", () => {
  it("SUMS a team's entrants — 1st + a tied 3rd beats 2nd + the other tied 3rd", async () => {
    const cup = await newCup("rollup Cup");
    const gameId = await newBracket(cup, "Rollup", fourSplit(cup), { distribution: [4, 2, 1, 1], pointsTotal: 8 });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    const lb = await board(cup);
    // A fielded seeds 1 (1st → 4) and 3 (tied 3rd → (1+1)/2 = 1) = 5.
    // B fielded seeds 2 (2nd → 2) and 4 (the other tied 3rd → 1) = 3.
    expect(lb.teamTotals[cup.teamA]).toBeCloseTo(5);
    expect(lb.teamTotals[cup.teamB]).toBeCloseTo(3);
    // The whole split is awarded — nothing stranded by the two-step roll-up.
    expect((lb.teamTotals[cup.teamA] ?? 0) + (lb.teamTotals[cup.teamB] ?? 0)).toBeCloseTo(8);
  });

  it("the per-game grid cell agrees with the totals", async () => {
    const cup = await newCup("cells Cup");
    const gameId = await newBracket(cup, "Cells", fourSplit(cup), { distribution: [4, 2, 1, 1], pointsTotal: 8 });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    const lb = await board(cup);
    const cells = lb.cells.filter((c) => c.gameId === gameId);
    expect(cells).toHaveLength(2);
    const cellA = cells.find((c) => c.teamId === cup.teamA)!;
    const cellB = cells.find((c) => c.teamId === cup.teamB)!;
    expect(cellA.points).toBeCloseTo(5);
    expect(cellB.points).toBeCloseTo(3);
    // Ranked by points, high wins — A led this game.
    expect(cellA.place).toBe(1);
    expect(cellB.place).toBe(2);
  });

  /**
   * The case one position per team cannot express, and the reason migration 119
   * exists: a team sweeping the field. Collapsing to a team's BEST place would pay
   * A four points; summing its entrants pays it six.
   */
  it("a team that fields 1st AND both tied 3rds is paid for all three", async () => {
    const cup = await newCup("sweep Cup");
    const sweep: Entrant[] = [
      { seed: 1, teamId: cup.teamA, userIds: [owner] },
      { seed: 2, teamId: cup.teamB, userIds: [planner] },
      { seed: 3, teamId: cup.teamA, userIds: [member] },
      { seed: 4, teamId: cup.teamA, userIds: [outsider] },
    ];
    const gameId = await newBracket(cup, "Sweep", sweep, { distribution: [4, 2, 1, 1], pointsTotal: 8 });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    const lb = await board(cup);
    // A: 1st (4) + both tied 3rds (1 + 1) = 6. B: 2nd (2).
    expect(lb.teamTotals[cup.teamA]).toBeCloseTo(6);
    expect(lb.teamTotals[cup.teamB]).toBeCloseTo(2);
  });

  /**
   * WINNER TAKES ALL is the same path, not a special case (119's "storage, not a
   * mandate"). Every entrant is still placed; a one-element distribution simply
   * pays place 1 — no branch anywhere.
   */
  it("a one-element distribution pays first place and nothing else", async () => {
    const cup = await newCup("wta Cup");
    const gameId = await newBracket(cup, "WTA", fourSplit(cup), { distribution: [8], pointsTotal: 8 });
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    // Still four rows in the database — the record is unaffected by the payout.
    expect(await resultsOf(gameId)).toHaveLength(4);
    const lb = await board(cup);
    expect(lb.teamTotals[cup.teamA]).toBeCloseTo(8);
    expect(lb.teamTotals[cup.teamB]).toBeCloseTo(0);
  });

  it("awards nothing before the bracket is posted, but still counts its pool", async () => {
    const cup = await newCup("pending Cup");
    const gameId = await newBracket(cup, "Pending", fourSplit(cup), { distribution: [4, 2, 1, 1], pointsTotal: 8 });
    await pick(gameId, 1, 1, 1);

    const lb = await board(cup);
    expect(lb.games.find((g) => g.id === gameId)!.pointsTotal).toBe(8);
    expect(lb.cells.filter((c) => c.gameId === gameId)).toHaveLength(0);
    expect(lb.teamTotals[cup.teamA]).toBeCloseTo(0);
    expect(lb.teamTotals[cup.teamB]).toBeCloseTo(0);
  });

  /**
   * An entrant with no cup team contributes nothing and does not take anyone
   * else's points with it. Migration 116 left the column nullable on purpose while
   * `saveConfig`'s zod refuses one — the refusal is a product-scope rule
   * ("standalone brackets aren't built yet"), not a data invariant. So this is a
   * state the database permits and the front door does not, and the roll-up has to
   * survive it.
   */
  it("an entrant with no team is skipped, and everyone else is unaffected", async () => {
    const cup = await newCup("orphan Cup");
    const gameId = await newBracket(cup, "Orphan", fourSplit(cup), { distribution: [4, 2, 1, 1], pointsTotal: 8 });
    await ctx.admin.from("bracket_entrants").update({ team_id: null }).eq("id", entrantId(gameId, 3));
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    // The RECORD still places all four — the entrant is skipped by the roll-up,
    // not dropped from the result.
    expect(await resultsOf(gameId)).toHaveLength(4);
    const lb = await board(cup);
    // A keeps only seed 1's 4; seed 3's tied-third share simply goes unclaimed.
    expect(lb.teamTotals[cup.teamA]).toBeCloseTo(4);
    // B keeps 2nd (2) + its tied 3rd (1).
    expect(lb.teamTotals[cup.teamB]).toBeCloseTo(3);
  });
});
