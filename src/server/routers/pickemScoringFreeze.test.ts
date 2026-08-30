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
let tripId: string;
let competitionId: string;
let gameId: string;
let slateIds: string[];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("r7 freeze");
  await ctx.addTripMember(tripId, "member", "Member");
  competitionId = await ctx.createCompetition(tripId, "freeze cup");
  const g = (await ctx.caller().games.create({
    tripId, gameTypeId: "gtt_pickem", name: "Freeze", competitionId,
  })) as { id: string };
  gameId = g.id;
  await ctx.admin.from("pickem_games").upsert({
    game_id: gameId, roll_up: "team_totals", use_confidence: true,
  });
  slateIds = [genId("sg"), genId("sg")];
  await ctx.admin.from("pickem_slate_games").insert(
    slateIds.map((id, i) => ({
      id, game_id: gameId, display_order: i,
      away_team: `A${i}`, home_team: `H${i}`, multiplier: 1,
    }))
  );
}, 120_000);

afterAll(async () => {
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
}, 60_000);

const hasResults = async () => {
  const { data } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: gameId });
  return data as boolean;
};
const hash = async () =>
  ((await ctx.caller().games.configHash({ tripId, gameId })) as { hash: string | null }).hash!;
const snapshot = async () => {
  const { data } = await ctx.admin.from("games").select("*").eq("id", gameId).single();
  return data as unknown as Parameters<typeof configToPickemDraft>[0];
};
/** Reads the STORED settings, as the view does. Passing them in makes the
 *  baseline a fiction and every change look like a no-op. */
const baseDraft = async () => {
  const { data } = await ctx.admin
    .from("pickem_games").select("roll_up, use_confidence").eq("game_id", gameId).single();
  return configToPickemDraft(await snapshot(), [], {
    rollUp: (data?.roll_up as "team_totals" | "individual_matches") ?? "team_totals",
    useConfidence: (data?.use_confidence as boolean) ?? true,
  }, []);
};

async function trySave(mutateDraft: (d: PickemConfigDraft) => PickemConfigDraft) {
  const base = await baseDraft();
  await ctx.caller().games.saveConfig({
    tripId, gameId, baseHash: await hash(),
    payload: pickemDraftToPayload(mutateDraft(base), base),
  });
}

const setResult = (r: "home" | null) =>
  ctx.authedClient("owner").rpc("set_pickem_result", {
    p_game_id: gameId, p_slate_game_id: slateIds[0], p_result: r,
  });

const flipRollUp = (d: PickemConfigDraft): PickemConfigDraft => ({
  ...d,
  rollUp: d.rollUp === "team_totals" ? "individual_matches" : "team_totals",
});

describe("the pick'em scoring freeze", () => {
  it("lets everything through while nothing is scored", async () => {
    expect(await hasResults()).toBe(false);
    await expect(trySave(flipRollUp)).resolves.toBeUndefined();
  }, 180_000);

  it("REFUSES a roll-up change once a result exists", async () => {
    await setResult("home");
    expect(await hasResults()).toBe(true);
    await expect(trySave(flipRollUp)).rejects.toThrow(/frozen/i);
  }, 180_000);

  it("...but still saves a RENAME — the freeze is about scoring", async () => {
    /**
     * The bug. The guard fires on the `pickem` key being PRESENT and the payload
     * always carried it, so any settings save was refused — and told the runner
     * that how the game SCORES is frozen, about a rename.
     *
     * Paired with the case above deliberately: "the rename works" alone is also
     * true of a build that dropped the freeze entirely, which is the failure
     * that would matter far more.
     */
    expect(await hasResults()).toBe(true);
    await expect(trySave((d) => ({ ...d, name: "Renamed" }))).resolves.toBeUndefined();
    const { data } = await ctx.admin.from("games").select("name").eq("id", gameId).single();
    expect(data?.name).toBe("Renamed");
  }, 180_000);

  it("CLEARING the results lifts it — the predicate is derived, not stored", async () => {
    // The question a runner who cleared them will have. There is no snapshot to
    // go stale, so the answer is yes and stays yes.
    await setResult(null);
    expect(await hasResults()).toBe(false);
    await expect(trySave(flipRollUp)).resolves.toBeUndefined();
  }, 180_000);
});
