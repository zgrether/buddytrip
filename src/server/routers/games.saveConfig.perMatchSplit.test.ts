import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToNonGolfDraft, nonGolfDraftToPayload, type NonGolfConfigDraft } from "../../lib/configDraft";

/**
 * #1381 — the boundary half: a game that pays MATCH BY MATCH cannot be given a
 * placement split through any write path.
 *
 * BBMI 2026's Cornhole reached production carrying `placement [8]` on a Matches
 * game. `validatePlacement` asked only whether the split summed and fitted, and
 * `[8]` over a total of 8 passes both. Every read surface then misread it.
 *
 * Each refusal below is paired with a CONTROL showing the same write succeeds
 * where a split is legitimate — a refusal that also refused the control would
 * pass every "is refused" assertion while breaking every points cup.
 */

const CARD = "gtt_generic_card";
const MATCH_PLAY = "gtt_match_play";
const REFUSAL = /pays match by match/;

let ctx: TestContext;
let tripId: string;
let competitionId: string;

async function getById(gameId: string) {
  return (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
}
async function hashOf(gameId: string) {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}
async function storedDistribution(gameId: string) {
  const { data } = await ctx.admin.from("games").select("points_distribution").eq("id", gameId).single();
  return data?.points_distribution ?? null;
}
async function newGame(gameTypeId: string, name: string) {
  return ((await ctx.caller().games.create({ tripId, gameTypeId, name, competitionId })) as { id: string }).id;
}
/** A non-golf payload built the way the client builds it, then (optionally) with a
 *  STALE split forced back in — the state a page draft from before the client-side
 *  clear, or a direct API caller, would send. */
async function nonGolfPayload(gameId: string, over: Partial<NonGolfConfigDraft>, forceDistribution?: unknown) {
  const draft: NonGolfConfigDraft = { ...configToNonGolfDraft(await getById(gameId), []), ...over };
  const payload = nonGolfDraftToPayload(draft);
  return forceDistribution === undefined ? payload : { ...payload, pointsDistribution: forceDistribution };
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("per-match split refusal Trip");
  competitionId = await ctx.createCompetition(tripId, "per-match split refusal Cup");
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("saveConfig — a split is refused on a game that pays per match", () => {
  it("non-golf switching INTO Matches in the same save, carrying a stale [8]: refused, nothing written", async () => {
    const gameId = await newGame(CARD, "Cornhole");
    const payload = await nonGolfPayload(
      gameId,
      { competitionFormat: "matches", pointsTotal: 8 },
      { type: "placement", values: [8] }
    );
    await expect(
      ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(REFUSAL) });
    // The format this save would have established was the deciding input, and the
    // write did not happen at all: still the pre-save format, no split.
    const g = await getById(gameId);
    expect(g.competition_format).not.toBe("matches");
    expect(await storedDistribution(gameId)).toBeNull();
  });

  it("CONTROL: the same [8] on a Head-to-Head game saves — the refusal is about the format, not the split", async () => {
    const gameId = await newGame(CARD, "Darts");
    const payload = await nonGolfPayload(
      gameId,
      { competitionFormat: "head_to_head", pointsTotal: 8 },
      { type: "placement", values: [8] }
    );
    await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload });
    expect(await storedDistribution(gameId)).toEqual({ type: "placement", values: [8] });
  });

  it("CONTROL: the client's own Matches payload (no forced split) saves per_match", async () => {
    const gameId = await newGame(CARD, "Bocce");
    const payload = await nonGolfPayload(gameId, {
      competitionFormat: "matches",
      pointsTotal: 8,
      pointsDistribution: { type: "placement", values: [8] },
    });
    await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload });
    expect((await storedDistribution(gameId) as { type: string } | null)?.type).toBe("per_match");
  });
});

describe("setPointsDistribution — the same refusal on the per-row path", () => {
  it("golf match play: a placement split is refused and nothing is written", async () => {
    const gameId = await newGame(MATCH_PLAY, "Singles");
    await expect(
      ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "placement", values: [4] } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(REFUSAL) });
    expect(((await storedDistribution(gameId)) as { type?: string } | null)?.type).not.toBe("placement");
  });

  it("CONTROL: per_match on the same game is still accepted", async () => {
    const gameId = await newGame(MATCH_PLAY, "Doubles");
    await ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: { type: "per_match", value: 2 } });
    expect(await storedDistribution(gameId)).toEqual({ type: "per_match", value: 2 });
  });
});

describe("games.update — a format switch to Matches cannot leave a split behind", () => {
  it("switching a placement-carrying game to Matches clears the split in the same write", async () => {
    const gameId = await newGame(CARD, "Horseshoes");
    await ctx.admin.from("games").update({ points_distribution: { type: "placement", values: [8] }, points_total: 8 }).eq("id", gameId);
    await ctx.caller().games.update({ tripId, gameId, competitionFormat: "matches" });
    const g = await getById(gameId);
    expect(g.competition_format).toBe("matches");
    expect(await storedDistribution(gameId)).toBeNull();
  });

  it("CONTROL: switching to a non-Matches format keeps the split", async () => {
    const gameId = await newGame(CARD, "Shuffleboard");
    await ctx.admin.from("games").update({ points_distribution: { type: "placement", values: [8] }, points_total: 8 }).eq("id", gameId);
    await ctx.caller().games.update({ tripId, gameId, competitionFormat: "head_to_head" });
    expect(await storedDistribution(gameId)).toEqual({ type: "placement", values: [8] });
  });
});
