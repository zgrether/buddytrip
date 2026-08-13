import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildDraw } from "../../lib/bracket";

/**
 * `games.pickWinner` / `games.bracketDraw` — recording who won (phase 3 slice 2).
 *
 * The pick is the bracket's equivalent of a score, and it is the ONE thing
 * `bracket_matches` stores beyond the tree's shape. Everything above a match is
 * derived from it (migration 112), so these tests are mostly about what the
 * server REFUSES: a pick that names someone who isn't in the match, a bye, a
 * match still waiting on the round below, and a posted bracket.
 *
 * Validation runs through the same `resolveDraw` the surface renders from
 * (CLAUDE.md #8), so a seat you can see is a seat the server accepts. A second
 * implementation here is exactly how the screen and the gate drift apart.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamId: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

interface Entrant {
  seed: number;
  teamId: string | null;
  userIds: string[];
}

async function newBracket(name: string, entrants: Entrant[], opts: { live?: boolean } = {}): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string };
  gameIds.push(g.id);
  const hash = (await ctx.caller().games.configHash({ tripId, gameId: g.id })).hash;
  await ctx.caller().games.saveConfig({
    tripId,
    gameId: g.id,
    baseHash: hash,
    payload: {
      name,
      rulesForToday: null,
      scoringEnabled: opts.live ?? true,
      pointsTotal: 4,
      pointsDistribution: null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: "bracket" as const,
      bracketConfig: { elimination: "single" as const, entrants: "singles" as const, seeding: "manual" as const, consolation: false },
      bracketEntrants: entrants,
      bracketDraw: buildDraw(entrants.length),
    },
  });
  return g.id;
}

/** Four singles entrants — a full 4-seat draw, no byes. */
const four = (): Entrant[] => [
  { seed: 1, teamId, userIds: [owner] },
  { seed: 2, teamId, userIds: [planner] },
  { seed: 3, teamId, userIds: [member] },
  { seed: 4, teamId, userIds: [outsider] },
];
/** Three entrants — seed 1 draws the bye. */
const three = (): Entrant[] => [
  { seed: 1, teamId, userIds: [owner] },
  { seed: 2, teamId, userIds: [planner] },
  { seed: 3, teamId, userIds: [member] },
];

const pick = (gameId: string, round: number, slot: number, winnerSeed: number | null, bracket: "main" | "consolation" = "main") =>
  ctx.caller().games.pickWinner({ tripId, gameId, bracket, round, slot, winnerSeed });
const drawOf = (gameId: string) => ctx.caller().games.bracketDraw({ tripId, gameId });
const at = (draw: Awaited<ReturnType<typeof drawOf>>, round: number, slot: number) =>
  draw.find((m) => m.bracket === "main" && m.round === round && m.slot === slot)!;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("bracket pick Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  competitionId = await ctx.createCompetition(tripId, "bracket pick Cup");
  teamId = await ctx.createTeam(competitionId, "Pick Team");
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("bracket_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("bracket_entrants").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("bracketDraw — the tree in seeds", () => {
  it("returns round-1 seeds and leaves later rounds empty", async () => {
    const gameId = await newBracket("Draw read", four());
    const draw = await drawOf(gameId);
    expect([at(draw, 1, 1).aSeed, at(draw, 1, 1).bSeed]).toEqual([1, 4]);
    expect([at(draw, 1, 2).aSeed, at(draw, 1, 2).bSeed]).toEqual([2, 3]);
    // Occupants of the final are DERIVED — the payload carries the stored row,
    // and advancement is the reader's job (one implementation, not two).
    expect([at(draw, 2, 1).aSeed, at(draw, 2, 1).bSeed]).toEqual([null, null]);
    expect(draw.every((m) => m.winnerSeed === null)).toBe(true);
  });
});

describe("pickWinner — recording a result", () => {
  it("records a winner, and the draw reads it back", async () => {
    const gameId = await newBracket("Record", four());
    await pick(gameId, 1, 1, 4);
    expect(at(await drawOf(gameId), 1, 1).winnerSeed).toBe(4);
  });

  it("accepts either side, not just the better seed", async () => {
    const gameId = await newBracket("Upset", four());
    await pick(gameId, 1, 2, 3);
    expect(at(await drawOf(gameId), 1, 2).winnerSeed).toBe(3);
  });

  it("a null winner CLEARS the pick", async () => {
    const gameId = await newBracket("Clear", four());
    await pick(gameId, 1, 1, 1);
    await pick(gameId, 1, 1, null);
    expect(at(await drawOf(gameId), 1, 1).winnerSeed).toBeNull();
  });

  it("accepts a pick in a DERIVED round once both feeders are decided", async () => {
    // The case that only works because validation runs the advancement: seeds 1
    // and 2 are nowhere in the final's stored row, they are computed into it.
    const gameId = await newBracket("Derived round", four());
    await pick(gameId, 1, 1, 1);
    await pick(gameId, 1, 2, 2);
    await pick(gameId, 2, 1, 2);
    expect(at(await drawOf(gameId), 2, 1).winnerSeed).toBe(2);
  });
});

describe("pickWinner — what it refuses", () => {
  it("someone who isn't in the match", async () => {
    const gameId = await newBracket("Not in match", four());
    // Seed 3 is in slot 2, not slot 1.
    await expect(pick(gameId, 1, 1, 3)).rejects.toThrow(/isn't in this match/);
  });

  it("a match still waiting on the round below", async () => {
    const gameId = await newBracket("Not ready", four());
    await pick(gameId, 1, 1, 1);
    // Only one semi decided, so the final has one seat.
    await expect(pick(gameId, 2, 1, 1)).rejects.toThrow(/waiting on the round below/);
  });

  it("a BYE — nobody played, so there is nothing to decide", async () => {
    const gameId = await newBracket("Bye", three());
    await expect(pick(gameId, 1, 1, 1)).rejects.toThrow(/bye/);
  });

  it("a match that isn't in the draw", async () => {
    const gameId = await newBracket("No such match", four());
    await expect(pick(gameId, 9, 9, 1)).rejects.toThrow(/isn't in this bracket/);
  });

  it("a bracket that isn't live yet", async () => {
    const gameId = await newBracket("Not live", four(), { live: false });
    await expect(pick(gameId, 1, 1, 1)).rejects.toThrow(/isn't live yet/);
  });

  it("a POSTED bracket, until it is reopened", async () => {
    const gameId = await newBracket("Posted", four());
    await ctx.admin.from("games").update({ status: "complete", corrections_open: false }).eq("id", gameId);
    await expect(pick(gameId, 1, 1, 1)).rejects.toThrow(/reopen it for corrections/);

    await ctx.admin.from("games").update({ corrections_open: true }).eq("id", gameId);
    await pick(gameId, 1, 1, 1);
    expect(at(await drawOf(gameId), 1, 1).winnerSeed).toBe(1);
  });

  it("a non-bracket game", async () => {
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name: "Cards", competitionId })) as { id: string };
    gameIds.push(g.id);
    await expect(pick(g.id, 1, 1, 1)).rejects.toThrow(/isn't a bracket/);
  });

  it("a member who is neither co-admin nor this game's delegate", async () => {
    const gameId = await newBracket("Permission", four());
    await expect(
      ctx.callerAs("member").games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: 1, winnerSeed: 1 })
    ).rejects.toThrow();
  });
});

describe("pickWinner — clearing does not cascade, and that is deliberate", () => {
  it("clearing a semi un-decides the final WITHOUT a second write", async () => {
    // The one-column undo. The final's own row still holds its winner; it simply
    // stops resolving, because the seed it names is no longer an occupant.
    const gameId = await newBracket("Undo", four());
    await pick(gameId, 1, 1, 1);
    await pick(gameId, 1, 2, 2);
    await pick(gameId, 2, 1, 1);
    await pick(gameId, 1, 1, null);

    const draw = await drawOf(gameId);
    expect(at(draw, 1, 1).winnerSeed).toBeNull();
    // Still stored, deliberately — the read returns the row as written.
    expect(at(draw, 2, 1).winnerSeed).toBe(1);
    // …and the server now refuses to treat seed 1 as the final's occupant.
    await expect(pick(gameId, 2, 1, 1)).rejects.toThrow(/waiting on the round below/);
  });

  it("re-picking the SAME semi winner brings the final's result back", async () => {
    // Surprising and correct: nothing about the final changed, and a cascade
    // that deleted it would throw away a real result for tidiness.
    const gameId = await newBracket("Resurrect", four());
    await pick(gameId, 1, 1, 1);
    await pick(gameId, 1, 2, 2);
    await pick(gameId, 2, 1, 1);
    await pick(gameId, 1, 1, null);
    await pick(gameId, 1, 1, 1);
    expect(at(await drawOf(gameId), 2, 1).winnerSeed).toBe(1);
  });

  it("re-picking a DIFFERENT semi winner leaves the final open", async () => {
    const gameId = await newBracket("Different", four());
    await pick(gameId, 1, 1, 1);
    await pick(gameId, 1, 2, 2);
    await pick(gameId, 2, 1, 1);
    await pick(gameId, 1, 1, 4);
    // Seed 1 is out, so the final's stored pick names someone who isn't there.
    await expect(pick(gameId, 2, 1, 1)).rejects.toThrow(/isn't in this match/);
    await pick(gameId, 2, 1, 4);
    expect(at(await drawOf(gameId), 2, 1).winnerSeed).toBe(4);
  });
});
