import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * save_game_config — the delegates KEY-GATE (migration 088, #625). Delegates is the one
 * list-write that used to run on EVERY Organizer save and `COALESCE(...,'[]')` a missing
 * key to empty — so an omitted `delegates` wiped them all (the live silent-wipe when a
 * client Saves before `listOrganizers` resolves). 088 gates it on `p_payload ? 'delegates'`
 * like its siblings (matches/groups/participants): ABSENT = preserve, PRESENT `[]` = clear.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let member: string;

async function newGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string };
  return g.id;
}
async function hashOf(gameId: string) {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}
async function delegatesOf(gameId: string): Promise<string[]> {
  return ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id).sort();
}

/** Minimal non-golf saveConfig payload. The `delegates` KEY is added ONLY when not
 *  omitted — so `omitDelegates: true` produces a payload with no delegates key at all
 *  (the absent-preserve path; the phantom-empty / unresolved-orgQ shape). */
function payload(over: { name?: string; delegates?: string[]; omitDelegates?: boolean }) {
  const base: Record<string, unknown> = {
    name: over.name ?? "Delegates game",
    rulesForToday: null,
    scoringEnabled: false,
    pointsTotal: null,
    pointsDistribution: null,
    courseId: null,
    backCourseId: null,
    scorecardSchema: null,
  };
  if (!over.omitDelegates) base.delegates = over.delegates ?? [];
  return base as never;
}

async function save(gameId: string, over: Parameters<typeof payload>[0]) {
  await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload: payload(over) });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig delegates Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  member = ctx.getUser("member").id;
  competitionId = await ctx.createCompetition(tripId, "saveConfig delegates Cup");
});
afterAll(async () => { await ctx.cleanup(); });

describe("save_game_config — delegates key-gate (088): absent preserves, empty clears", () => {
  it("a PRESENT delegates list sets the delegate", async () => {
    const gameId = await newGame("set");
    await save(gameId, { delegates: [member] });
    expect(await delegatesOf(gameId)).toEqual([member]);
  });

  it("an OMITTED delegates key PRESERVES the current set — the silent-wipe fix", async () => {
    const gameId = await newGame("preserve");
    await save(gameId, { delegates: [member] });
    expect(await delegatesOf(gameId)).toEqual([member]);
    // A later save that omits the key entirely (the phantom-empty / unresolved-orgQ shape)
    // must NOT touch delegates. Pre-088 this wiped them.
    await save(gameId, { name: "renamed", omitDelegates: true });
    expect(await delegatesOf(gameId)).toEqual([member]);
    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("renamed");
  });

  it("a PRESENT empty list clears the delegates (the deliberate remove-all)", async () => {
    const gameId = await newGame("clear");
    await save(gameId, { delegates: [member] });
    expect(await delegatesOf(gameId)).toEqual([member]);
    await save(gameId, { delegates: [] });
    expect(await delegatesOf(gameId)).toEqual([]);
  });
});
