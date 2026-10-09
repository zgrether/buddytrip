import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { buildDraw } from "../../lib/bracket";

/**
 * Ruling 8, through the app: removal (the archive, migration 209) withdraws a
 * bracket entrant when its last member still on the trip leaves, and the router
 * resolves the draw with that mark — the board's draw rows carry it, a pick on a
 * walkover is refused, and finalize places the forfeiter. People leave through
 * `tripMembers.remove`, so this exercises the wiring and not only the SQL.
 *
 * Every case builds its own cup (destructive writes, CLAUDE.md).
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

interface Cup { tripId: string; competitionId: string; teamA: string; teamB: string }
interface Entrant { seed: number; teamId: string | null; userIds: string[] }

async function newCup(name: string): Promise<Cup> {
  const { tripId, competitionId } = await ctx.createCupTrip({
    title: "bracket withdrawal Trip", name, scoringModel: "points",
    members: [["planner", "Organizer"], "member", "outsider"],
  });
  const teamA = await ctx.createTeam(competitionId, "Manhattans");
  const teamB = await ctx.createTeam(competitionId, "Centurions");
  return { tripId, competitionId, teamA, teamB };
}

async function newBracket(cup: Cup, name: string, entrants: Entrant[], partners = false): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId: cup.tripId, gameTypeId: CARD, name, competitionId: cup.competitionId })) as { id: string };
  const hash = (await ctx.caller().games.configHash({ tripId: cup.tripId, gameId: g.id })).hash;
  await ctx.caller().games.saveConfig({
    tripId: cup.tripId, gameId: g.id, baseHash: hash,
    payload: {
      name, rulesForToday: null, scoringEnabled: true, pointsTotal: 8,
      pointsDistribution: { type: "placement" as const, values: [5, 3] },
      courseId: null, backCourseId: null, scorecardSchema: null, delegates: [],
      competitionFormat: "bracket" as const,
      bracketConfig: { elimination: "single" as const, entrants: partners ? ("partners" as const) : ("singles" as const), seeding: "manual" as const, consolation: false },
      bracketEntrants: entrants,
      bracketDraw: buildDraw(entrants.length),
    },
  });
  return g.id;
}

const draw = (cup: Cup, gameId: string) => ctx.caller().games.bracketDraw({ tripId: cup.tripId, gameId });
const pick = (cup: Cup, gameId: string, round: number, slot: number, winnerSeed: number | null) =>
  ctx.caller().games.pickWinner({ tripId: cup.tripId, gameId, bracket: "main", round, slot, winnerSeed });
const remove = (cup: Cup, userId: string) => ctx.caller().tripMembers.remove({ tripId: cup.tripId, userId });

async function withdrawnAt(gameId: string, seed: number) {
  const { data, error } = await ctx.admin.from("bracket_entrants").select("withdrawn_at").eq("game_id", gameId).eq("seed", seed).single();
  if (error) throw error;
  return data.withdrawn_at as string | null;
}

/** The round-1 row a seed sits in. */
async function r1Of(cup: Cup, gameId: string, seed: number) {
  const rows = await draw(cup, gameId);
  return rows.find((r) => r.round === 1 && (r.aSeed === seed || r.bSeed === seed))!;
}

/** Four singles: seed = owner 1, planner 2, member 3, outsider 4. */
const four = (cup: Cup): Entrant[] => [
  { seed: 1, teamId: cup.teamA, userIds: [owner] },
  { seed: 2, teamId: cup.teamB, userIds: [planner] },
  { seed: 3, teamId: cup.teamA, userIds: [member] },
  { seed: 4, teamId: cup.teamB, userIds: [outsider] },
];

describe("a bracket entrant withdraws when its last member leaves", () => {
  it("the sole member leaves: marked, flagged on the draw, a pick on the walkover refused, and finalize places them", async () => {
    const cup = await newCup("withdraw sole");
    const gameId = await newBracket(cup, "Cornhole", four(cup));
    expect(await withdrawnAt(gameId, 3)).toBeNull(); // premise

    await remove(cup, member);
    expect(await withdrawnAt(gameId, 3)).not.toBeNull();

    const row = await r1Of(cup, gameId, 3);
    expect(row.aSeed === 3 ? row.aWithdrawn : row.bWithdrawn).toBe(true);
    const opponent = row.aSeed === 3 ? row.bSeed! : row.aSeed!;
    // CONTROL on the same row: the opponent is not flagged.
    expect(row.aSeed === 3 ? row.bWithdrawn : row.aWithdrawn).toBe(false);

    await expect(pick(cup, gameId, 1, row.slot, opponent)).rejects.toThrow(/walkover/);

    // Play out the rest: the other round-1 match, then the final.
    const other = (await draw(cup, gameId)).find((r) => r.round === 1 && r.slot !== row.slot)!;
    await pick(cup, gameId, 1, other.slot, other.aSeed!);
    await pick(cup, gameId, 2, 1, Math.min(opponent, other.aSeed!));
    await ctx.caller().games.finish({ tripId: cup.tripId, gameId });

    const { data: ents } = await ctx.admin.from("bracket_entrants").select("id, seed").eq("game_id", gameId);
    const idOf3 = ents!.find((e) => e.seed === 3)!.id as string;
    const { data: res } = await ctx.admin.from("game_results").select("entity_id, position").eq("game_id", gameId).eq("entity_id", idOf3);
    // Out in round 1 of 2 at four entrants: the tied 3rd.
    expect(res).toEqual([{ entity_id: idOf3, position: 3 }]);
  });

  it("a PARTNERSHIP: the partner plays on; the entrant withdraws only when its last member leaves", async () => {
    const cup = await newCup("withdraw partners");
    const gameId = await newBracket(cup, "Doubles", [
      { seed: 1, teamId: cup.teamA, userIds: [owner, planner] },
      { seed: 2, teamId: cup.teamB, userIds: [member, outsider] },
    ], true);

    await remove(cup, member);
    expect(await withdrawnAt(gameId, 2)).toBeNull();
    // The departed member's row stays: their wins keep their name.
    // Scoped to THIS game's entrant: the shared test member sits in other cases' brackets too.
    const { data: e2 } = await ctx.admin.from("bracket_entrants").select("id").eq("game_id", gameId).eq("seed", 2).single();
    const { count } = await ctx.admin.from("bracket_entrant_members")
      .select("user_id", { count: "exact", head: true }).eq("entrant_id", e2!.id).eq("user_id", member);
    expect(count).toBe(1);

    await remove(cup, outsider);
    expect(await withdrawnAt(gameId, 2)).not.toBeNull();
  });

  it("a FINISHED bracket is history: leaving withdraws nothing there — while an unfinished one beside it IS withdrawn", async () => {
    // The unfinished bracket is not decoration: the archive's whole clean-up runs
    // only when the trip HAS an unfinished game, so without one this case could not
    // tell "finished brackets are skipped" from "nothing ran at all".
    const cup = await newCup("withdraw finished");
    const gameId = await newBracket(cup, "Finished", four(cup));
    const rows = await draw(cup, gameId);
    for (const r of rows.filter((x) => x.round === 1)) await pick(cup, gameId, 1, r.slot, Math.min(r.aSeed!, r.bSeed!));
    await pick(cup, gameId, 2, 1, 1);
    await ctx.caller().games.finish({ tripId: cup.tripId, gameId });
    const live = await newBracket(cup, "Still going", four(cup));

    await remove(cup, member);
    expect(await withdrawnAt(gameId, 3)).toBeNull();
    expect(await withdrawnAt(live, 3)).not.toBeNull();
  });

  it("the draw flags a withdrawal on WHICHEVER seat the entrant sits in", async () => {
    // Seeds 2 and 3 meet in round 1, one in each seat; both leave.
    const cup = await newCup("withdraw both seats");
    const gameId = await newBracket(cup, "Both seats", four(cup));
    await remove(cup, planner);
    await remove(cup, member);
    const row = await r1Of(cup, gameId, 2);
    expect(row.aSeed === 3 || row.bSeed === 3).toBe(true); // premise: they meet
    expect([row.aWithdrawn, row.bWithdrawn]).toEqual([true, true]);
    // CONTROL: the other round-1 match carries no flag.
    const other = (await draw(cup, gameId)).find((r) => r.round === 1 && r.slot !== row.slot)!;
    expect([other.aWithdrawn, other.bWithdrawn]).toEqual([false, false]);
  });

  it("a win recorded BEFORE leaving stands; the NEXT match is the walkover", async () => {
    const cup = await newCup("withdraw after a win");
    const gameId = await newBracket(cup, "Upset", four(cup));
    const row = await r1Of(cup, gameId, 3);
    await pick(cup, gameId, 1, row.slot, 3); // seed 3 wins round 1

    await remove(cup, member);

    // Round 1 still says 3 won; the final, where 3 now stands, is the walkover.
    const after = await draw(cup, gameId);
    expect(after.find((r) => r.round === 1 && r.slot === row.slot)!.winnerSeed).toBe(3);
    const other = after.find((r) => r.round === 1 && r.slot !== row.slot)!;
    await pick(cup, gameId, 1, other.slot, other.aSeed!);
    await expect(pick(cup, gameId, 2, 1, 3)).rejects.toThrow(/walkover/);
    await ctx.caller().games.finish({ tripId: cup.tripId, gameId });

    const { data: ents } = await ctx.admin.from("bracket_entrants").select("id, seed").eq("game_id", gameId);
    const idOf = (s: number) => ents!.find((e) => e.seed === s)!.id as string;
    const { data: res } = await ctx.admin.from("game_results").select("entity_id, position").eq("game_id", gameId);
    const pos = (s: number) => res!.find((r) => r.entity_id === idOf(s))?.position;
    expect(pos(other.aSeed!)).toBe(1); // the walkover's winner is champion
    expect(pos(3)).toBe(2);            // out in the final it withdrew from
  });
});
