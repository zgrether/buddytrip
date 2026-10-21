import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToNonGolfDraft, nonGolfDraftToPayload, type NonGolfConfigDraft } from "../../lib/configDraft";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

/**
 * #1686 — a non-golf Matches game cannot go live with no matches drawn.
 *
 * The settings page takes a game live through `games.saveConfig`, which leaves
 * readiness to `save_game_config`. That function checked pairing for golf match
 * play only, so a Matches game fell into the general arm (points only) and went
 * live with nobody paired, while the board's own `isConfigured` still read it as
 * not set up.
 *
 * Every payload is built with the client's own builder (`nonGolfDraftToPayload`),
 * which sends only FILLED matches: a half-paired draft never reaches the
 * database, so "no filled match" is the state the app can actually produce. Each
 * case builds a fresh game, and the refusals are paired with a control that goes
 * live, so a build refusing everything cannot pass.
 */

const CARD = "gtt_generic_card";
const REFUSAL = "Pair every match before enabling scoring.";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let alpha: string;
let bravo: string;

async function newGame(name: string): Promise<string> {
  return ((await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string }).id;
}

async function goLive(gameId: string, matches: NonGolfConfigDraft["matches"]) {
  const game = (await ctx.caller().games.getById({ tripId, gameId })) as Parameters<typeof configToNonGolfDraft>[0];
  const baseline = configToNonGolfDraft(game, []);
  const draft: NonGolfConfigDraft = {
    ...baseline,
    competitionFormat: MATCHES_COMPETITION_FORMAT,
    pointsTotal: 4,
    scoringEnabled: true,
    matches,
  };
  const baseHash = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
  return ctx.caller().games.saveConfig({ tripId, gameId, baseHash, payload: nonGolfDraftToPayload(draft, baseline) });
}

async function scoringEnabled(gameId: string): Promise<boolean> {
  const { data } = await ctx.admin.from("games").select("scoring_enabled").eq("id", gameId).single();
  return data?.scoring_enabled === true;
}

const match = (a: string[], b: string[]) => ({ matchNumber: 1, playersPerSide: 1 as const, a, b, handicap: 0, pointValue: null });

beforeAll(async () => {
  ctx = await TestContext.create();
  const cup = await ctx.createCupTrip({ name: "Matches go-live", members: ["member"], teams: ["Alpha", "Bravo"] });
  ({ tripId, competitionId } = cup);
  [alpha, bravo] = cup.teamIds;
  await ctx.assignTeam(competitionId, alpha, [ctx.user.id]);
  await ctx.assignTeam(competitionId, bravo, [ctx.getUser("member").id]);
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("a Matches game goes live only with every match paired (#1686)", () => {
  it("no matches at all: refused, and the game stays off", async () => {
    const gameId = await newGame("Cornhole");
    await expect(goLive(gameId, [])).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: REFUSAL });
    expect(await scoringEnabled(gameId)).toBe(false);
  });

  it("a match with one side empty (the draft the builder drops): refused, and the game stays off", async () => {
    const gameId = await newGame("Darts");
    await expect(goLive(gameId, [match([ctx.user.id], [])])).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: REFUSAL });
    expect(await scoringEnabled(gameId)).toBe(false);
  });

  it("CONTROL: every match paired goes live", async () => {
    const gameId = await newGame("Bocce");
    await goLive(gameId, [match([ctx.user.id], [ctx.getUser("member").id])]);
    expect(await scoringEnabled(gameId)).toBe(true);
  });
});
