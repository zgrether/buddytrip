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
function payload(over: {
  name?: string;
  delegates?: string[];
  omitDelegates?: boolean;
  /** The column a delegate may NOT change — see the boundary block at the end. */
  pointsTotal?: number | null;
}) {
  const base: Record<string, unknown> = {
    name: over.name ?? "Delegates game",
    rulesForToday: null,
    scoringEnabled: false,
    pointsTotal: over.pointsTotal ?? null,
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

describe("the delegate tier around points (migration 158)", () => {
  /**
   * Slice D (#360) put `points_total` above the delegate tier — "owner sets the
   * total; a game-delegate distributes within". Migration 158 revisited that
   * three months on: the rationale described who typically sets the total, not
   * who may, and `points_distribution` — the other half of the same settings
   * row — had always been in the delegate tier.
   *
   * `games.d_addgame.test.ts` carries the reasoning; this file covers the RPC.
   */

  async function delegate(gameId: string) {
    await save(gameId, { delegates: [member] });
    expect(await delegatesOf(gameId)).toEqual([member]);
  }

  it("a DELEGATE's save writes points_total", async () => {
    const gameId = await newGame("delegate points");
    await delegate(gameId);

    await ctx.callerAs("member").games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: payload({ name: "set by delegate", omitDelegates: true, pointsTotal: 14 }),
    });

    const g = await ctx.caller().games.getById({ tripId, gameId });
    expect(g.points_total).toBe(14);
    expect(g.name).toBe("set by delegate");
  });

  it("the old failure was SILENT, so this asserts the VALUE", async () => {
    // Pre-158 this exact call RESOLVED — the delegate was admitted by
    // `assert_game_edit`, the name persisted, and points_total was dropped
    // inside the function with nothing raised. A test that only checked "does
    // not throw" would have passed against the bug, which is why the assertion
    // reads the column back.
    const gameId = await newGame("value not resolution");
    await delegate(gameId);
    await ctx.caller().games.setPointsTotal({ tripId, gameId, total: 8 });

    await ctx.callerAs("member").games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: payload({ name: "n", omitDelegates: true, pointsTotal: 14 }),
    });

    expect((await ctx.caller().games.getById({ tripId, gameId })).points_total).toBe(14);
  });

  it("games.setPointsTotal admits the same tier — one column, one answer", async () => {
    // Two doors onto `points_total`. Leaving the setter staff-only would make
    // the answer depend on which one you came through.
    const gameId = await newGame("sibling setter");
    await delegate(gameId);
    await ctx.callerAs("member").games.setPointsTotal({ tripId, gameId, total: 21 });
    expect((await ctx.caller().games.getById({ tripId, gameId })).points_total).toBe(21);
  });

  it("a plain MEMBER with no grant is still refused, by both doors", async () => {
    const gameId = await newGame("plain member");
    await expect(
      ctx.callerAs("member").games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: payload({ name: "nope", omitDelegates: true, pointsTotal: 99 }),
      })
    ).rejects.toThrow();
    await expect(
      ctx.callerAs("member").games.setPointsTotal({ tripId, gameId, total: 99 })
    ).rejects.toThrow();
  });
});

describe("delegation itself did NOT move — and now REFUSES instead of dropping", () => {
  /**
   * The other column `v_is_org` guards. It keeps the staff gate on purpose:
   * granting delegation is "changes who is trusted", the one thing the tier
   * above the delegate exists to hold.
   *
   * What changed is the FAILURE MODE. It was `IF v_is_org AND p_payload ?
   * 'delegates'`, so a delegate sending the key had it silently dropped from an
   * otherwise-successful save — the same shape that hid the points_total gate
   * for months. Now a change is refused outright.
   */

  async function delegate(gameId: string) {
    await save(gameId, { delegates: [member] });
    expect(await delegatesOf(gameId)).toEqual([member]);
  }

  it("a delegate attempting to sub-delegate is REFUSED, not ignored", async () => {
    const gameId = await newGame("sub-delegate refused");
    await delegate(gameId);

    await expect(
      ctx.callerAs("member").games.saveConfig({
        tripId,
        gameId,
        baseHash: await hashOf(gameId),
        payload: payload({ name: "n", delegates: [member, ctx.getUser("outsider").id] }),
      })
    ).rejects.toThrow();

    // ...and nothing was granted on the way past.
    expect(await delegatesOf(gameId)).toEqual([member]);
  });

  it("an UNCHANGED delegate set still passes — presence is not a change", async () => {
    // The case that makes the refusal safe. Every format's payload builder may
    // include the key; refusing on PRESENCE would stop a delegate saving
    // anything at all. Same distinction migration 157 needed for the pick'em
    // freeze.
    const gameId = await newGame("unchanged set passes");
    await delegate(gameId);

    await ctx.callerAs("member").games.saveConfig({
      tripId,
      gameId,
      baseHash: await hashOf(gameId),
      payload: payload({ name: "renamed by delegate", delegates: [member] }),
    });

    expect((await ctx.caller().games.getById({ tripId, gameId })).name).toBe("renamed by delegate");
    expect(await delegatesOf(gameId)).toEqual([member]);
  });

  it("staff can still change the set", async () => {
    const gameId = await newGame("staff can");
    await delegate(gameId);
    await save(gameId, { delegates: [] });
    expect(await delegatesOf(gameId)).toEqual([]);
  });
});
