import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildDoubleDraw } from "../../lib/bracketDouble";
import { resolveDoubleDraw, } from "../../lib/bracketDoubleAdvance";
import { matchKey, type WinnerBySeed } from "../../lib/bracketAdvance";

/**
 * PHASE 0 F1 — a DOUBLE bracket must not finalize as a single one.
 *
 * `deriveBracketPlacements` called `resolveDraw` unconditionally. That resolver
 * handles `main` + `consolation` and DROPS `lower`/`final` rows, and the gate
 * immediately after it is `drawComplete(resolved)` — so the undecided
 * lower-bracket rows were never in the set it checked. Production's one double
 * bracket was posted with 4 of 15 matches undecided.
 *
 * ── THIS FILE IS THE ONLY INSTRUMENT ON THE WIRING, AND CI IS THE ONLY PLACE
 *    IT RUNS ──────────────────────────────────────────────────────────────
 *
 * `bracketFormat.test.ts` carries the pure half, and it carries as much of this
 * claim as a pure test can reach: the refusal IS `if (!drawComplete(resolved))
 * throw`, and that file asserts, on a real half-played double draw built by
 * `buildDoubleDraw`, that the gate's INPUT now reports the bracket unfinished
 * (and that the old resolver reported it finished). What it cannot reach is the
 * WIRING — that `games.finish` actually routes through those functions and
 * surfaces the refusal to a caller.
 *
 * That is this file, it needs the local Supabase stack, and it was written in a
 * container without Docker — so it has never been observed to pass or fail
 * locally. CI adjudicates it. Stated plainly because a test nobody has watched
 * go red is not yet evidence (CLAUDE.md), and this one guards the more important
 * half.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];
const compIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("double bracket finish Trip");
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

/** A double-elimination bracket over four entrants, two per team. */
async function newDoubleBracket(name: string): Promise<string> {
  // A POINTS cup: a bracket pays by placement, and a Match Play cup refuses switching a
  // game into one (ruling 2, PR 4). Brackets are tested where they can now be set up.
  const competitionId = await ctx.createCompetition(tripId, name, { scoringModel: "points" });
  compIds.push(competitionId);
  const teamA = await ctx.createTeam(competitionId, "Manhattans");
  const teamB = await ctx.createTeam(competitionId, "Centurions");
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: CARD, name, competitionId,
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
      pointsDistribution: { type: "placement" as const, values: [5, 3, 0, 0] },
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: "bracket" as const,
      bracketConfig: {
        elimination: "double" as const,
        entrants: "singles" as const,
        seeding: "manual" as const,
        consolation: false,
      },
      bracketEntrants: [
        { seed: 1, teamId: teamA, userIds: [owner] },
        { seed: 2, teamId: teamB, userIds: [planner] },
        { seed: 3, teamId: teamA, userIds: [member] },
        { seed: 4, teamId: teamB, userIds: [outsider] },
      ],
      // The REAL builder, so the persisted draw is the shape the app produces —
      // a hand-rolled one is where the lower bracket quietly goes missing and the
      // test then measures a tree nobody plays.
      bracketDraw: buildDoubleDraw(4),
    },
  });
  return g.id;
}

/** Decide every playable MAIN match, favourite advancing. Leaves `lower` open —
 *  the state production's bracket was actually in when it posted. */
async function playMainOnly(gameId: string): Promise<number> {
  const draw = buildDoubleDraw(4);
  const winners: WinnerBySeed = {};
  let picks = 0;
  for (;;) {
    const next = resolveDoubleDraw(draw, winners).find((m) => m.playable && m.bracket === "main");
    if (!next) return picks;
    const winnerSeed = Math.min(next.aSeed!, next.bSeed!);
    await ctx.caller().games.pickWinner({
      tripId, gameId, bracket: "main", round: next.round, slot: next.slot, winnerSeed,
    });
    winners[matchKey(next)] = winnerSeed;
    if (++picks > draw.length + 5) throw new Error("main bracket did not settle");
  }
}

describe("games.finish — a double bracket with an undecided lower bracket", () => {
  it("is REFUSED, not posted as single elimination", async () => {
    const gameId = await newDoubleBracket("Double Elim — lower open");
    const picks = await playMainOnly(gameId);
    expect(picks, "the fixture must actually have played the main bracket").toBeGreaterThan(0);

    await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // And nothing was written. A refusal that still posts rows is the failure
    // this exists to catch, so it is asserted in the DATABASE rather than
    // inferred from the throw.
    const { data } = await ctx.admin.from("game_results").select("entity_id").eq("game_id", gameId);
    expect(data ?? []).toEqual([]);
  });
});
