import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildDraw } from "../../lib/bracket";

/**
 * A FINISHED RESULT'S CREDITED UNIT IS STORED, NOT RE-DERIVED (ruling 15,
 * migration 191).
 *
 * "Which team is Alice on?" is a fact about NOW. "Which team did this game pay?"
 * is a fact about THEN, and answering the second with the first is the same
 * words pointed at a different question. A finished game's credit cannot be
 * re-derived, because the inputs no longer exist in the state they had.
 *
 * ── What this file can and cannot see ──────────────────────────────────────
 *
 * It needs the local Supabase stack, and it was written in a container with no
 * Docker daemon — so it has NEVER been observed to pass or fail locally. CI is
 * its only instrument. Said plainly rather than implied, as PR 0's integration
 * test said the same thing.
 *
 * What HAS been mutation-checked locally is the decision each of these pins:
 * `resultConvention.test.ts` (4 mutants) and `writeGameResults.test.ts`'s credit
 * cases (3 mutants). This file is the claim that those decisions reach the
 * database and come back out of the board in one piece — the seam a stubbed
 * test cannot cover, and the one migration 119's header warns about.
 *
 * ── Every "unchanged" test carries its opposite ────────────────────────────
 *
 * A test asserting a number did not move passes just as well against a board
 * that cannot move it at all, or against a fixture whose mutation never landed.
 * So each stability case here is paired with a POSITIVE CONTROL in the same
 * block: the same change, applied BEFORE the finalize, must move the number.
 * Two arms, one credible, is what made the roster-race harness's green
 * disbelievable — and that is the only reason it was caught.
 */

const CARD = "gtt_generic_card";
const YARD = "gtt_generic_yard";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];
const compIds: string[] = [];

interface Cup {
  competitionId: string;
  teamA: string;
  teamB: string;
}

/** A fresh cup per case: `teamTotals` sums every game in a competition, so a
 *  shared one would make each assertion depend on what ran before it. */
async function newCup(name: string): Promise<Cup> {
  const competitionId = await ctx.createCompetition(tripId, name);
  compIds.push(competitionId);
  const teamA = await ctx.createTeam(competitionId, "Manhattans");
  const teamB = await ctx.createTeam(competitionId, "Centurions");
  return { competitionId, teamA, teamB };
}

interface Entrant {
  seed: number;
  teamId: string | null;
  userIds: string[];
}

/** Seeds 1+3 on team A, 2+4 on team B. */
const fourSplit = (cup: Cup): Entrant[] => [
  { seed: 1, teamId: cup.teamA, userIds: [owner] },
  { seed: 2, teamId: cup.teamB, userIds: [planner] },
  { seed: 3, teamId: cup.teamA, userIds: [member] },
  { seed: 4, teamId: cup.teamB, userIds: [outsider] },
];

async function newBracket(cup: Cup, name: string, entrants: Entrant[]): Promise<string> {
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
      pointsTotal: 8,
      pointsDistribution: { type: "placement" as const, values: [4, 2, 1, 1] },
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: "bracket" as const,
      bracketConfig: {
        elimination: "single" as const,
        entrants: "singles" as const,
        seeding: "manual" as const,
        consolation: false,
      },
      bracketEntrants: entrants,
      bracketDraw: buildDraw(entrants.length, { consolation: false }),
    },
  });
  return g.id;
}

const pick = (gameId: string, round: number, slot: number, winnerSeed: number) =>
  ctx.caller().games.pickWinner({ tripId, gameId, bracket: "main", round, slot, winnerSeed });

/** `buildDraw(4)` pairs 1v4 and 2v3: seed 1 wins, 2 is runner-up, 3 and 4 tie 3rd. */
async function playChalk4(gameId: string) {
  await pick(gameId, 1, 1, 1);
  await pick(gameId, 1, 2, 2);
  await pick(gameId, 2, 1, 1);
}

const entrantId = (gameId: string, seed: number) => `${gameId}:e${seed}`;

async function rowsOf(gameId: string) {
  const { data } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, position, raw_score, value_kind, credited_team_id")
    .eq("game_id", gameId);
  return (data ?? []) as {
    entity_id: string;
    entity_type: string;
    position: number | null;
    raw_score: number | null;
    value_kind: string | null;
    credited_team_id: string | null;
  }[];
}

const totalsOf = async (cup: Cup) => {
  const board = await ctx.caller().competitions.leaderboard({ tripId, competitionId: cup.competitionId });
  return (board as { teamTotals: Record<string, number> }).teamTotals;
};

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("credited unit Trip");
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

describe("a bracket records WHO IT PAID, not just who competed", () => {
  it("stamps each entrant row with its entrant's cup team, and declares the rank", async () => {
    const cup = await newCup("bracket credit Cup");
    const gameId = await newBracket(cup, "Chalk", fourSplit(cup));
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });

    const rows = await rowsOf(gameId);
    expect(rows).toHaveLength(4);
    const creditOf = new Map(rows.map((r) => [r.entity_id, r.credited_team_id]));
    // The exact team per seed, not "is not null": a derivation that credited
    // every row to the first team it saw would satisfy a presence check, and
    // this fixture splits the four entrants across BOTH teams precisely so that
    // a single-team answer is wrong.
    expect(creditOf.get(entrantId(gameId, 1))).toBe(cup.teamA);
    expect(creditOf.get(entrantId(gameId, 2))).toBe(cup.teamB);
    expect(creditOf.get(entrantId(gameId, 3))).toBe(cup.teamA);
    expect(creditOf.get(entrantId(gameId, 4))).toBe(cup.teamB);

    // And every row says what it carries. `writeManualResults` mirrors the rank
    // into `raw_score`, so this is the declaration doing work a column read
    // cannot: both columns are populated on all four rows.
    expect(rows.every((r) => r.value_kind === "rank")).toBe(true);
    expect(rows.every((r) => r.raw_score === r.position)).toBe(true);
  });

  it("does not follow the entrant's team after the game is finished", async () => {
    const cup = await newCup("bracket stability Cup");
    const gameId = await newBracket(cup, "Chalk", fourSplit(cup));
    await playChalk4(gameId);
    await ctx.caller().games.finish({ tripId, gameId });
    const before = await totalsOf(cup);

    /**
     * WRITTEN WITH THE SERVICE ROLE, AND THAT IS THE POINT RATHER THAN A
     * SHORTCUT.
     *
     * `save_game_config` is the only application writer of
     * `bracket_entrants.team_id`, and its `v_bracket_dirty` comparison includes
     * that column — so HAS_PICKS refuses this edit once any winner exists. The
     * credit is therefore frozen today, but INCIDENTALLY: that guard exists to
     * stop a rebuild destroying recorded winners, and freezing the credit is a
     * side effect of it.
     *
     * This test asserts the board does not LEAN on that coincidence. Expressing
     * "the entrant's team moved" requires going around the guard, because the
     * guard is the only thing currently preventing it — and someone narrowing
     * that guard to the draw rows alone, a reasonable-looking optimisation,
     * would unfreeze credit with nothing to say so.
     */
    const { error } = await ctx.admin
      .from("bracket_entrants")
      .update({ team_id: cup.teamB })
      .eq("id", entrantId(gameId, 1));
    expect(error).toBeNull();

    expect(await totalsOf(cup)).toEqual(before);
  });

  it("POSITIVE CONTROL — the same move BEFORE the finalize does change the credit", async () => {
    // Without this, the case above passes against a board that cannot read
    // entrant teams at all, and against a fixture whose UPDATE silently matched
    // no rows. The difference between the two cases is exactly one thing: which
    // side of `games.finish` the move happened on.
    const cup = await newCup("bracket control Cup");
    const gameId = await newBracket(cup, "Chalk", fourSplit(cup));
    await playChalk4(gameId);

    const { error } = await ctx.admin
      .from("bracket_entrants")
      .update({ team_id: cup.teamB })
      .eq("id", entrantId(gameId, 1));
    expect(error).toBeNull();

    await ctx.caller().games.finish({ tripId, gameId });
    const rows = await rowsOf(gameId);
    const creditOf = new Map(rows.map((r) => [r.entity_id, r.credited_team_id]));
    expect(creditOf.get(entrantId(gameId, 1))).toBe(cup.teamB);

    /**
     * And the TOTALS move with it, to an exact pair the pre-move fixture cannot
     * produce.
     *
     * `[4, 2, 1, 1]` over chalk: seed 1 takes 4, seed 2 takes 2, and seeds 3
     * and 4 tie at third, so `placementPoints` averages indices 2 and 3 —
     * `(1 + 1) / 2` — and each takes 1.
     *
     *   entrants as seeded (1,3 = A · 2,4 = B) → A 5, B 3
     *   seed 1 moved to B                      → A 1, B 7
     *
     * Asserted as both exact numbers rather than "A is zero" or "B is more than
     * zero": seed 3 is still on team A and still scores, so A is NOT emptied by
     * this move, and a `> 0` on B would be satisfied by the unmoved fixture too.
     */
    const totals = await totalsOf(cup);
    expect({ a: totals[cup.teamA] ?? 0, b: totals[cup.teamB] ?? 0 }).toEqual({ a: 1, b: 7 });
  });
});

describe("a team-row format is paid by the team on the row, not by today's roster", () => {
  /** A non-golf placement game, finalized by entered order. */
  async function newPlacementGame(cup: Cup, name: string): Promise<string> {
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: YARD, name, competitionId: cup.competitionId,
    })) as { id: string };
    gameIds.push(g.id);
    return g.id;
  }

  it("keeps its standings when a player is traded after the finalize", async () => {
    const cup = await newCup("trade stability Cup");
    await ctx.caller().teamAssignments.assign({ tripId, competitionId: cup.competitionId, userId: owner, teamId: cup.teamA });
    await ctx.caller().teamAssignments.assign({ tripId, competitionId: cup.competitionId, userId: planner, teamId: cup.teamB });

    const gameId = await newPlacementGame(cup, "Cornhole");
    await ctx.caller().games.finish({
      tripId,
      gameId,
      placements: [
        { entityId: cup.teamA, position: 1 },
        { entityId: cup.teamB, position: 2 },
      ],
    });

    const rows = await rowsOf(gameId);
    // The credit is the row's own entity — redundant on a team row by design,
    // so that "who gets these points" is one column for every format.
    expect(rows.every((r) => r.credited_team_id === r.entity_id)).toBe(true);
    expect(rows.every((r) => r.value_kind === "rank")).toBe(true);

    const before = await totalsOf(cup);

    /**
     * Through the REAL mutation, not the service role — and it is genuinely
     * reachable. `assertRosterUnlocked` keys the trade lock on `score_entries`,
     * which a non-golf game never writes, so this cup is still UNLOCKED after
     * being decided. `teams.ts` says so in its own comment. That makes this the
     * plan's case rather than a synthetic one.
     */
    await ctx.caller().teamAssignments.assign({
      tripId, competitionId: cup.competitionId, userId: owner, teamId: cup.teamB,
    });

    expect(await totalsOf(cup)).toEqual(before);
  });

  it("POSITIVE CONTROL — the trade itself lands, so the case above is about the RESULT", async () => {
    // The stability assertion above would also pass if `assign` had quietly
    // failed. This reads the roster back: the move is real, and the finished
    // game simply does not consult it.
    const cup = await newCup("trade control Cup");
    await ctx.caller().teamAssignments.assign({ tripId, competitionId: cup.competitionId, userId: owner, teamId: cup.teamA });
    await ctx.caller().teamAssignments.assign({ tripId, competitionId: cup.competitionId, userId: owner, teamId: cup.teamB });

    const { data } = await ctx.admin
      .from("team_assignments")
      .select("team_id")
      .eq("competition_id", cup.competitionId)
      .eq("user_id", owner)
      .maybeSingle();
    expect((data as { team_id: string } | null)?.team_id).toBe(cup.teamB);
  });
});
