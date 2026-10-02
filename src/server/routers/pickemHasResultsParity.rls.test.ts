import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `_pickem_has_results` (SQL) vs `pickem.get`'s `hasResults` (TypeScript).
 *
 * ── Why there are two, and why that is permanent ───────────────────────────
 *
 * The SQL function is the AUTHORITY: it is what `save_game_config` and
 * `save_pickem_config` actually refuse on (migration 157). It answers about a
 * CONTAINER rather than about its caller, so per CLAUDE.md #28 it is REVOKEd
 * from `authenticated` and the router cannot call it. SQL cannot import
 * TypeScript, so `pickem.get` mirrors it — exactly as `pickemLifecycle.ts`
 * mirrors `pickem_picks_open`, and this file is the same instrument
 * `pickemLifecycleParity.rls.test.ts` is.
 *
 * ── What a mismatch would look like, which is why it needs a test ──────────
 *
 * Nothing errors. The settings page offers a row the RPC then refuses
 * (`PICKEM_SCORED` out of nowhere on Save), or hides a row that was still
 * editable. Both read as a caching bug and neither points at a predicate.
 *
 * Change either side and this fails, which is the point.
 */

let ctx: TestContext;

/**
 * EVERY CASE BUILDS ITS OWN GAME (#1527). They shared one: a `beforeEach`
 * cleared slate results between cases, but not matches, results or the game's
 * status — and "a match marked complete counts" updated a match row that only
 * the PREVIOUS case had inserted. Shuffled ahead of it, its update touched no
 * row and SQL read false. Each case now seeds exactly the state it asks about.
 */
type Pickem = { tripId: string; competitionId: string; gameId: string };

async function freshPickem(label: string): Promise<Pickem> {
  const tripId = await ctx.createTrip(`hasResults parity ${label}`);
  const competitionId = await ctx.createCompetition(tripId, `hasResults parity Cup ${label}`);
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Parity pick'em",
    competitionId,
  })) as { id: string };
  const { error } = await ctx.admin.from("pickem_games").upsert({ game_id: g.id });
  if (error) throw new Error(`seed pickem_games: ${error.message}`);
  return { tripId, competitionId, gameId: g.id };
}

/** The SQL authority, read through the service client — the function is
 *  REVOKEd from `authenticated`, which is the whole reason the mirror exists. */
async function sqlSaysHasResults(g: Pickem): Promise<boolean> {
  const { data, error } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: g.gameId });
  if (error) throw new Error("_pickem_has_results: " + error.message);
  return data as boolean;
}

/** The TypeScript mirror, read the way the client actually gets it. */
async function routerSaysHasResults(g: Pickem): Promise<boolean> {
  const res = (await ctx.caller().pickem.get({ tripId: g.tripId, gameId: g.gameId })) as { hasResults: boolean };
  return res.hasResults;
}

/** Assert the two AGREE, and say what they agreed on — a test that only
 *  compared them would pass if both were stuck on false forever. */
async function bothSay(g: Pickem, expected: boolean, label: string) {
  const sql = await sqlSaysHasResults(g);
  const ts = await routerSaysHasResults(g);
  expect(sql, `${label}: SQL`).toBe(expected);
  expect(ts, `${label}: router`).toBe(expected);
}

/** Every seed write is checked: an update or insert that silently matched or
 *  wrote nothing would leave the predicate reading a state nobody set. */
async function must(label: string, p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
}

/** One undecided match on the game, as the outcome-mode path writes it. */
async function seedMatch(g: Pickem) {
  await must("seed match", ctx.admin.from("game_matches").insert({
    id: genId("gm-parity"),
    game_id: g.gameId,
    match_number: 1,
    display_order: 0,
    side_a: { type: "user", id: ctx.getUser("owner").id },
    side_b: { type: "user", id: ctx.getUser("member").id },
    status: "pending",
  }));
}

beforeAll(async () => {
  ctx = await TestContext.create();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("_pickem_has_results — SQL and the router mirror agree", () => {
  it("a fresh game: nothing scored", async () => {
    await bothSay(await freshPickem("fresh"), false, "fresh");
  });

  it("a RESOLVED SLATE GAME makes it true — the arm the mirror was missing", async () => {
    /**
     * Migration 159 added this arm to the SQL and its own comment calls it
     * "THE PRIMARY SOURCE during Run". The TypeScript mirror was never grown
     * to match, and THIS SUITE COULD NOT SEE IT: every case here exercised one
     * of the three arms that existed before 159, so it stayed green while the
     * two sides disagreed on the most common state in the feature — a game
     * having its results entered and nothing else scored.
     *
     * It was live. `scoringSettingsEditable(hasResults)` said the three
     * scoring settings were editable while `save_pickem_config` refused them —
     * the exact failure the mirror's own comment promises it prevents.
     *
     * A guard has to grow when the thing it guards does.
     */
    const g = await freshPickem("slate");
    const slateId = genId("parity-sg");
    await must("seed slate", ctx.admin.from("pickem_slate_games").insert({
      id: slateId, game_id: g.gameId, display_order: 0,
      away_team: "Alabama", home_team: "Georgia", multiplier: 1, result: "home",
    }));

    await bothSay(g, true, "a resolved slate game");

    // ...and clearing it puts BOTH back to false, so this is the slate result
    // talking and not some residue from elsewhere.
    await must("clear slate result", ctx.admin.from("pickem_slate_games").update({ result: null }).eq("id", slateId));
    await bothSay(g, false, "slate result cleared");
  });

  it("a PUSH and a CANCELLATION count too — a zero-scoring result is a result", async () => {
    // They score nothing for everyone, so a board reading 0-0 looks cleared.
    // Both predicates must still say the game has produced an outcome — this is
    // the state that held the pairing freeze in migration 162.
    for (const result of ["push", "cancelled"] as const) {
      const g = await freshPickem(result);
      await bothSay(g, false, `${result}: before`); // premise
      await must(`seed ${result}`, ctx.admin.from("pickem_slate_games").insert({
        id: genId("parity-zero"), game_id: g.gameId, display_order: 0,
        away_team: "A", home_team: "B", multiplier: 1, result,
      }));
      await bothSay(g, true, result);
    }
  });

  it("a game_results row makes it true", async () => {
    const g = await freshPickem("results");
    await must("seed result", ctx.admin.from("game_results").insert({
      id: genId("gr-parity"),
      game_id: g.gameId,
      entity_type: "user", value_kind: "rank",
      entity_id: ctx.getUser("owner").id,
      raw_score: 1,
      position: 1,
    }));
    await bothSay(g, true, "game_results");
    await must("remove result", ctx.admin.from("game_results").delete().eq("game_id", g.gameId));
    await bothSay(g, false, "game_results removed");
  });

  it("a DECIDED match makes it true — the outcome-mode path with no game_results", async () => {
    // The case a `game_results`-only check would miss, and the reason both
    // sides read `game_matches` too. `result` is CHECK-constrained to
    // a_win/b_win/halve, so this exercises a real value rather than a
    // placeholder the constraint would have refused.
    const g = await freshPickem("decided-match");
    await seedMatch(g);
    await bothSay(g, false, "match present but undecided");

    await must("decide match", ctx.admin.from("game_matches").update({ result: "a_win" }).eq("game_id", g.gameId));
    await bothSay(g, true, "match decided");

    await must("clear match result", ctx.admin.from("game_matches").update({ result: null }).eq("game_id", g.gameId));
    await bothSay(g, false, "result cleared");
  });

  it("a match marked complete counts even with a null result", async () => {
    // Its own match — it used to update the row the case above had inserted.
    const g = await freshPickem("complete-match");
    await seedMatch(g);
    await bothSay(g, false, "match present, pending, no result"); // premise
    await must("complete match", ctx.admin.from("game_matches").update({ status: "complete" }).eq("game_id", g.gameId));
    await bothSay(g, true, "match complete");
    await must("reopen match", ctx.admin.from("game_matches").update({ status: "pending" }).eq("game_id", g.gameId));
    await bothSay(g, false, "match back to pending");
  });

  it("a FINISHED game counts, whatever its matches say", async () => {
    const g = await freshPickem("finished");
    await bothSay(g, false, "not finished"); // premise
    await must("finish game", ctx.admin.from("games").update({ status: "complete" }).eq("id", g.gameId));
    await bothSay(g, true, "game complete");
    await must("reopen game", ctx.admin.from("games").update({ status: "pending" }).eq("id", g.gameId));
    await bothSay(g, false, "game back to pending");
  });

  it("the SQL side is scoped to pick'em, and the mirror is only ever asked about pick'em", async () => {
    // The bug caught during 157: unscoped, the freeze in `save_game_config`
    // applied to every format and a finalized match-play game could no longer
    // have its points edited.
    const g = await freshPickem("scoped");
    const other = (await ctx.caller().games.create({
      tripId: g.tripId,
      gameTypeId: "gtt_generic_card",
      name: "Not pick'em",
      competitionId: g.competitionId,
    })) as { id: string };
    await must("finish other game", ctx.admin.from("games").update({ status: "complete" }).eq("id", other.id));

    const { data, error } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: other.id });
    if (error) throw new Error(`_pickem_has_results: ${error.message}`);
    expect(data).toBe(false);
  });
});
