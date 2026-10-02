import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import {
  configToPickemDraft,
  pickemDraftToPayload,
  type PickemConfigDraft,
} from "@/lib/configDraft";

/**
 * The scoring freeze must refuse a SCORING change and nothing else.
 *
 * ── What it refused instead ────────────────────────────────────────────────
 *
 * `save_game_config` gates on the PRESENCE of the `pickem` key:
 *
 *     IF _pickem_has_results(game) THEN
 *       IF (payload ? 'pickem') OR (payload ? 'pointsTotal' AND <changed>)
 *         RAISE 'PICKEM_SCORED: results are in, so how this game scores is frozen'
 *
 * `pointsTotal` is tested for a CHANGED VALUE; `pickem` only for being there —
 * and `pickemDraftToPayload` sent it unconditionally. So the moment any result
 * existed the WHOLE settings page was unsaveable, and renaming the game was
 * refused with a sentence about how it scores.
 *
 * Sending the key only when it differs restores the guard's intent rather than
 * dodging it. The always-send rule exists so a CHANGE is never lost, and a
 * change is still always sent.
 *
 * ── And the freeze is fully DERIVED ────────────────────────────────────────
 *
 * `_pickem_has_results` reads live state — no snapshot — so clearing the results
 * lifts it. Asserted below, because "does clearing undo the freeze" is exactly
 * the question a runner who cleared them will have, and the answer being yes is
 * only useful if it stays true.
 */

let ctx: TestContext;
const madeGames: string[] = [];

/**
 * EVERY CASE BUILDS ITS OWN GAME (#1527). They shared one and walked it
 * unscored → scored → renamed → cleared, each case relying on the result the
 * one before had set or cleared. Shuffled, "lets everything through while
 * nothing is scored" met a result, and "still saves a RENAME" met none — so a
 * rename that would have worked anyway proved nothing about the freeze.
 */
type Pickem = { tripId: string; gameId: string; slateIds: string[] };

async function freshPickem(label: string, opts: { scored: boolean }): Promise<Pickem> {
  const tripId = await ctx.createTrip(`r7 freeze ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  const competitionId = await ctx.createCompetition(tripId, `freeze cup ${label}`);
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_pickem", name: "Freeze", competitionId,
  })) as { id: string };
  madeGames.push(g.id);
  const pg = await ctx.admin.from("pickem_games").upsert({
    game_id: g.id, roll_up: "team_totals", use_confidence: true,
  });
  if (pg.error) throw new Error(`seed pickem_games: ${pg.error.message}`);
  const slateIds = [genId("sg"), genId("sg")];
  const sg = await ctx.admin.from("pickem_slate_games").insert(
    slateIds.map((id, i) => ({
      id, game_id: g.id, display_order: i,
      away_team: `A${i}`, home_team: `H${i}`, multiplier: 1,
    }))
  );
  if (sg.error) throw new Error(`seed slate: ${sg.error.message}`);
  const game = { tripId, gameId: g.id, slateIds };
  if (opts.scored) await setResult(game, "home");
  expect(await hasResults(game)).toBe(opts.scored); // premise
  return game;
}

const hasResults = async (g: Pickem) => {
  const { data, error } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: g.gameId });
  if (error) throw new Error(`_pickem_has_results: ${error.message}`);
  return data as boolean;
};
const hash = async (g: Pickem) =>
  ((await ctx.caller().games.configHash({ tripId: g.tripId, gameId: g.gameId })) as { hash: string | null }).hash!;
const snapshot = async (g: Pickem) => {
  const { data, error } = await ctx.admin.from("games").select("*").eq("id", g.gameId).single();
  if (error) throw new Error(`read game: ${error.message}`);
  return data as unknown as Parameters<typeof configToPickemDraft>[0];
};
/** Reads the STORED settings, as the view does. Passing them in makes the
 *  baseline a fiction and every change look like a no-op. */
const baseDraft = async (g: Pickem) => {
  const { data, error } = await ctx.admin
    .from("pickem_games").select("roll_up, use_confidence").eq("game_id", g.gameId).single();
  if (error) throw new Error(`read pickem settings: ${error.message}`);
  return configToPickemDraft(await snapshot(g), [], {
    rollUp: (data?.roll_up as "team_totals" | "individual_matches") ?? "team_totals",
    useConfidence: (data?.use_confidence as boolean) ?? true,
  }, []);
};

async function trySave(g: Pickem, mutateDraft: (d: PickemConfigDraft) => PickemConfigDraft) {
  const base = await baseDraft(g);
  await ctx.caller().games.saveConfig({
    tripId: g.tripId, gameId: g.gameId, baseHash: await hash(g),
    payload: pickemDraftToPayload(mutateDraft(base), base),
  });
}

async function setResult(g: Pickem, r: "home" | null) {
  const { error } = await ctx.authedClient("owner").rpc("set_pickem_result", {
    p_game_id: g.gameId, p_slate_game_id: g.slateIds[0], p_result: r,
  });
  if (error) throw new Error(`set_pickem_result: ${error.message}`);
}

async function rollUpOf(g: Pickem): Promise<string> {
  const { data, error } = await ctx.admin.from("pickem_games").select("roll_up").eq("game_id", g.gameId).single();
  if (error) throw new Error(`read roll_up: ${error.message}`);
  return data!.roll_up as string;
}

const flipRollUp = (d: PickemConfigDraft): PickemConfigDraft => ({
  ...d,
  rollUp: d.rollUp === "team_totals" ? "individual_matches" : "team_totals",
});

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  if (madeGames.length) {
    await ctx.admin.from("pickem_slate_games").delete().in("game_id", madeGames);
    await ctx.admin.from("games").delete().in("id", madeGames);
  }
  await ctx.cleanup();
}, 60_000);

describe("the pick'em scoring freeze", () => {
  it("lets everything through while nothing is scored", async () => {
    const g = await freshPickem("unscored", { scored: false });
    await expect(trySave(g, flipRollUp)).resolves.toBeUndefined();
    expect(await rollUpOf(g)).toBe("individual_matches"); // it really saved
  }, 180_000);

  it("REFUSES a roll-up change once a result exists", async () => {
    const g = await freshPickem("scored", { scored: true });
    await expect(trySave(g, flipRollUp)).rejects.toThrow(/frozen/i);
    expect(await rollUpOf(g)).toBe("team_totals"); // unchanged
  }, 180_000);

  it("...but still saves a RENAME — the freeze is about scoring", async () => {
    /**
     * The bug. The guard fires on the `pickem` key being PRESENT and the payload
     * always carried it, so any settings save was refused — and told the runner
     * that how the game SCORES is frozen, about a rename.
     *
     * Paired with the case above deliberately: "the rename works" alone is also
     * true of a build that dropped the freeze entirely, which is the failure
     * that would matter far more. And it must run on a SCORED game — on an
     * unscored one the rename succeeds whatever the guard does.
     */
    const g = await freshPickem("rename", { scored: true });
    await expect(trySave(g, (d) => ({ ...d, name: "Renamed" }))).resolves.toBeUndefined();
    const { data, error } = await ctx.admin.from("games").select("name").eq("id", g.gameId).single();
    if (error) throw new Error(`read name: ${error.message}`);
    expect(data?.name).toBe("Renamed");
  }, 180_000);

  it("CLEARING the results lifts it — the predicate is derived, not stored", async () => {
    // The question a runner who cleared them will have. There is no snapshot to
    // go stale, so the answer is yes and stays yes.
    const g = await freshPickem("cleared", { scored: true });
    await expect(trySave(g, flipRollUp)).rejects.toThrow(/frozen/i); // premise: frozen first
    await setResult(g, null);
    expect(await hasResults(g)).toBe(false);
    await expect(trySave(g, flipRollUp)).resolves.toBeUndefined();
  }, 180_000);
});
