import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToNonGolfDraft, nonGolfDraftToPayload, type NonGolfConfigDraft } from "../../lib/configDraft";
import { headToHeadResultRefusal } from "../../lib/headToHeadResult";

/**
 * Ruling 2 (PR 4): a Match Play cup accepts games whose result is head to head,
 * so it refuses switching a game INTO a bracket — through both writers of
 * `competition_format`, `games.saveConfig` and `games.update`.
 *
 * Each case is one a wrong build gets wrong:
 *  - no guard: the switch into a bracket lands (the first two cases);
 *  - a guard on the VALUE rather than the CHANGE: the grandfathered bracket —
 *    BBMI Test Cup has three — becomes unsaveable over a field nobody touched,
 *    migration 114's trap (the third case);
 *  - a guard that ignores the cup's type: a points race loses its brackets;
 *  - a guard too wide on configuration: Simple / Matches / best-of-N, all head
 *    to head between two teams, are refused.
 *
 * Saves are built with `configToNonGolfDraft` → `nonGolfDraftToPayload`, the
 * path the settings page takes, so the payload carries every key the app sends
 * (CLAUDE.md, "a fixture that does not send what the real caller sends").
 */

const CARD = "gtt_generic_card";
const REFUSAL = headToHeadResultRefusal(CARD, "bracket")!;

let ctx: TestContext;
let tripId: string;
let ryderCup: string;
let pointsCup: string;

async function newGame(competitionId: string, name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string };
  return g.id;
}
async function formatOf(gameId: string): Promise<string | null> {
  const { data } = await ctx.admin.from("games").select("competition_format").eq("id", gameId).single();
  return (data as { competition_format: string | null }).competition_format;
}
async function saveNG(gameId: string, overrides: Partial<NonGolfConfigDraft>) {
  const game = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
  const delegates = ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id);
  const draft: NonGolfConfigDraft = { ...configToNonGolfDraft(game, delegates), ...overrides };
  const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
  return ctx.caller().games.saveConfig({ tripId, gameId, baseHash: hash, payload: nonGolfDraftToPayload(draft) });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("H2H format trip");
  ryderCup = await ctx.createCompetition(tripId, "Ryder", { scoringModel: "match_play" });
  pointsCup = await ctx.createCompetition(tripId, "Points", { scoringModel: "points" });
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("a Match Play cup refuses switching a game into a bracket", () => {
  it("saveConfig: refused with the shared sentence, and nothing is written", async () => {
    const gameId = await newGame(ryderCup, "Cards");
    await expect(saveNG(gameId, { competitionFormat: "bracket" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: REFUSAL,
    });
    expect(await formatOf(gameId)).toBeNull();
  }, 60_000);

  it("games.update: refused the same way", async () => {
    const gameId = await newGame(ryderCup, "Cards via update");
    await expect(
      ctx.caller().games.update({ tripId, gameId, competitionFormat: "bracket" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: REFUSAL });
    expect(await formatOf(gameId)).toBeNull();
  }, 60_000);

  it("a game ALREADY a bracket stays saveable — the value is re-sent untouched, and only a change is refused", async () => {
    const gameId = await newGame(ryderCup, "Grandfathered");
    // The state BBMI Test Cup's three brackets are in: set before this rule existed.
    const pre = await ctx.admin.from("games").update({ competition_format: "bracket" }).eq("id", gameId);
    expect(pre.error).toBeNull();
    await expect(saveNG(gameId, { name: "Grandfathered, renamed" })).resolves.toBeTruthy();
    expect(await formatOf(gameId)).toBe("bracket");
  }, 60_000);

  it.each(["head_to_head", "matches", "best_of_n"] as const)(
    "admits %s — head to head between two teams",
    async (format) => {
      const gameId = await newGame(ryderCup, `Cards ${format}`);
      await expect(saveNG(gameId, { competitionFormat: format })).resolves.toBeTruthy();
      expect(await formatOf(gameId)).toBe(format);
    },
    60_000,
  );

  it("leaves a points race alone — a bracket is what it pays by", async () => {
    const gameId = await newGame(pointsCup, "Points bracket");
    await expect(
      ctx.caller().games.update({ tripId, gameId, competitionFormat: "bracket" }),
    ).resolves.toBeTruthy();
    expect(await formatOf(gameId)).toBe("bracket");
  }, 60_000);
});
