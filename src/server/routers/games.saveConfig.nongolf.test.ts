import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToNonGolfDraft, nonGolfDraftToPayload, type NonGolfConfigDraft, type BracketConfig } from "../../lib/configDraft";

/**
 * save_game_config — the NON-GOLF flip (P2 phase 2). Non-golf routes its WHOLE lean
 * config (name / rules / delegate / competition_format / points / scoring) through the
 * one atomic Save, using the NonGolfConfigDraft variant. The headline is the THESIS:
 * non-golf has NO destroys-tier setting, so every setting is saveable on a LIVE game —
 * the model keyed on "what the write path does to existing data" yields "no locks" for
 * the format that has no destructive write. (Structurally, non-golf results live in
 * `game_results`, not `score_entries`/`match_hole_outcomes`, so the RPC's HAS_SCORES
 * guard — which keys on those — can't fire for it.)
 */

const CARD = "gtt_generic_card";

/** A complete bracket config — the type is total, so a partial would not compile. */
const BASE_BRACKET: BracketConfig = {
  elimination: "single",
  entrants: "partners",
  seeding: "random_avoid_teammates",
  consolation: false,
};

let ctx: TestContext;
let tripId: string;
let competitionId: string;

async function newNonGolfGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string };
  return g.id;
}
async function getById(gameId: string) {
  return (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
}
async function hashOf(gameId: string) {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}
async function delegatesOf(gameId: string) {
  return ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id);
}

/** Build the lean non-golf payload from the current server state + overrides — the SAME
 *  configToNonGolfDraft → nonGolfDraftToPayload path the client uses. */
async function saveNG(gameId: string, overrides: Partial<NonGolfConfigDraft>) {
  const draft: NonGolfConfigDraft = { ...configToNonGolfDraft(await getById(gameId), await delegatesOf(gameId)), ...overrides };
  await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(gameId), payload: nonGolfDraftToPayload(draft) });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig non-golf Trip");
  competitionId = await ctx.createCompetition(tripId, "saveConfig non-golf Cup");
});
afterAll(async () => { await ctx.cleanup(); });

describe("saveConfig — non-golf: the whole lean page saves atomically, no locks (thesis)", () => {
  it("the payload is LEAN — no matches / entryMode / modifiers keys (RPC skips those blocks)", async () => {
    const gameId = await newNonGolfGame("NG lean");
    const payload = nonGolfDraftToPayload(configToNonGolfDraft(await getById(gameId), []));
    expect(payload).not.toHaveProperty("matches");
    expect(payload).not.toHaveProperty("matchesStructureDirty");
    expect(payload).not.toHaveProperty("entryMode");
    expect(payload).not.toHaveProperty("modifiers");
  });

  it("no-op Save is byte-identical — the faithless-mirror guard for non-golf", async () => {
    const gameId = await newNonGolfGame("NG no-op");
    await saveNG(gameId, { pointsTotal: 8 });
    const before = await hashOf(gameId);
    await saveNG(gameId, {}); // re-send the same config
    expect(await hashOf(gameId)).toBe(before);
  });

  it("competition_format writes through saveConfig (086 — was the last self-persisting setting)", async () => {
    const gameId = await newNonGolfGame("NG format");
    await saveNG(gameId, { competitionFormat: "best_of_n" });
    expect((await getById(gameId)).competition_format).toBe("best_of_n");
    // COALESCE-preserve: a later save that omits format keeps it (only non-golf sends it).
    await saveNG(gameId, { name: "Renamed" });
    expect((await getById(gameId)).competition_format).toBe("best_of_n");
  });

  it("a NON-bracket game saves cleanly, though its bracket_config column is {} (112's default)", async () => {
    // The regression this exists for: `bracket_config` is NOT NULL DEFAULT '{}',
    // so every game in the database has one and every non-bracket game's is `{}`.
    // Reading it with a cast made the draft carry a truthy empty object, the
    // payload included it, and the RPC's zod refused a save on EVERY non-bracket
    // game — a field the user never touched breaking a field they did.
    const gameId = await newNonGolfGame("NG plain");
    await saveNG(gameId, { name: "Still saveable" });
    expect((await getById(gameId)).name).toBe("Still saveable");
  });

  it("bracket_config writes through saveConfig, and an omitted key PRESERVES it (113)", async () => {
    // The bracket's scalar settings ride the same atomic Save as a draft slice
    // (#18) rather than a live games.update.
    const cfg = {
      elimination: "single",
      entrants: "partners",
      seeding: "random_avoid_teammates",
      consolation: true,
    } satisfies BracketConfig;
    const gameId = await newNonGolfGame("NG bracket");
    await saveNG(gameId, { competitionFormat: "bracket", bracketConfig: cfg });
    expect((await getById(gameId)).bracket_config).toEqual(cfg);

    // COALESCE-PRESERVE is the half that matters. Every format sends the full
    // config it owns and an absent key resets that column — right for `modifiers`,
    // wrong here, because only a bracket game speaks for `bracketConfig`. Without
    // it, ANY other save on this game wipes the bracket's setup.
    await saveNG(gameId, { name: "Renamed again" });
    expect((await getById(gameId)).bracket_config).toEqual(cfg);
  });

  it("bracket_config moves the config hash, so a mid-setup change reaches other devices", async () => {
    // The #16 invariant, checked at the moment the write appears rather than
    // after someone notices it never propagated. `bracket_config` was added to
    // GAME_CONFIG_COLS in 112 — one migration BEFORE anything could write it.
    const gameId = await newNonGolfGame("NG bracket hash");
    await saveNG(gameId, { competitionFormat: "bracket", bracketConfig: { ...BASE_BRACKET, consolation: false } });
    const before = await hashOf(gameId);

    await saveNG(gameId, { bracketConfig: { ...BASE_BRACKET, consolation: true } });
    const after = await hashOf(gameId);
    expect(after).not.toBe(before);

    // …and no churn on an idempotent re-write.
    await saveNG(gameId, { bracketConfig: { ...BASE_BRACKET, consolation: true } });
    expect(await hashOf(gameId)).toBe(after);
  });

  it("THE THESIS — a LIVE non-golf game saves EVERY setting, no refusal", async () => {
    const gameId = await newNonGolfGame("NG live");
    await saveNG(gameId, { pointsTotal: 8 }); // ready (points configured)
    await saveNG(gameId, { pointsTotal: 8, scoringEnabled: true }); // go live via the atomic Save
    expect((await getById(gameId)).scoring_enabled).toBe(true);

    // Now LIVE — change name + format + points in ONE save. No lock fires (non-golf has
    // no destroys-tier setting; its results aren't in score_entries). It just lands.
    await saveNG(gameId, { name: "Renamed Live", competitionFormat: "bracket_se", pointsTotal: 12, scoringEnabled: true });
    const g = await getById(gameId);
    expect(g.name).toBe("Renamed Live");
    expect(g.competition_format).toBe("bracket_se");
    expect(Number(g.points_total)).toBe(12);
    expect(g.scoring_enabled).toBe(true);
  });
});
