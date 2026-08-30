import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Phase 5 — Run. Recording each slate game's outcome.
 *
 * Three of these are written to fail against a plausible WRONG build, which is
 * the handoff's own framing and the reason they are shaped the way they are:
 *
 *   - a suite that only sets WINNERS passes against a model that cannot express
 *     a push at all
 *   - a suite that only enters results in SLATE ORDER passes against an
 *     implementation that assumes one
 *   - a suite that only runs as OWNER passes against a gate that excludes
 *     delegates
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;
let slateIds: string[];
let owner: string;
let member: string;
let planner: string;

const SLATE_SIZE = 4;

async function seedSlate() {
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  slateIds = Array.from({ length: SLATE_SIZE }, () => genId("sg"));
  await ctx.admin.from("pickem_slate_games").insert(
    slateIds.map((id, i) => ({
      id,
      game_id: gameId,
      display_order: i,
      away_team: `Away${i}`,
      home_team: `Home${i}`,
      multiplier: 1,
    }))
  );
}

/** The runner records one outcome. Defaults to the OWNER; pass a role to check
 *  the gate admits (or refuses) someone else. */
function setResult(
  slateGameId: string,
  result: "away" | "home" | "push" | "cancelled" | null,
  role: "owner" | "member" | "planner" = "owner"
) {
  return ctx.authedClient(role).rpc("set_pickem_result", {
    p_game_id: gameId,
    p_slate_game_id: slateGameId,
    p_result: result,
  });
}

async function resultsOf(): Promise<(string | null)[]> {
  const { data } = await ctx.admin
    .from("pickem_slate_games")
    .select("id, display_order, result")
    .eq("game_id", gameId)
    .order("display_order");
  return (data ?? []).map((r) => (r.result as string | null) ?? null);
}

async function rollUp(mode: "team_totals" | "individual_matches") {
  await ctx.admin.from("pickem_games").update({ roll_up: mode }).eq("game_id", gameId);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("pickem Run Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  planner = ctx.getUser("planner").id;
  competitionId = await ctx.createCompetition(tripId, "pickem Run Cup");
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Run",
    competitionId,
  })) as { id: string };
  gameId = g.id;
  await ctx.admin.from("pickem_games").upsert({
    game_id: gameId,
    picks_opened_at: new Date(Date.now() - 3_600_000).toISOString(),
    picks_locked_at: new Date().toISOString(),
    roll_up: "team_totals",
  });
  await seedSlate();
});

beforeEach(async () => {
  await ctx.admin.from("pickem_slate_games").update({ result: null }).eq("game_id", gameId);
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("games").update({ status: "active" }).eq("id", gameId);
  await rollUp("team_totals");
});

afterAll(async () => {
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

describe("results are four-valued and reversible", () => {
  it("records each of the four outcomes", async () => {
    // The push/cancelled half is what a winners-only suite would miss.
    for (const [i, r] of (["away", "home", "push", "cancelled"] as const).entries()) {
      const { error } = await setResult(slateIds[i], r);
      expect(error, r).toBeNull();
    }
    expect(await resultsOf()).toEqual(["away", "home", "push", "cancelled"]);
  });

  it("any outcome clears back to unplayed", async () => {
    for (const r of ["away", "push", "cancelled"] as const) {
      await setResult(slateIds[0], r);
      const { error } = await setResult(slateIds[0], null);
      expect(error, r).toBeNull();
      expect((await resultsOf())[0]).toBeNull();
    }
  });

  it("refuses a value outside the four", async () => {
    // The CHECK and the RPC both hold this; without either, a typo becomes a
    // silently unscoreable game.
    const { error } = await ctx.authedClient("owner").rpc("set_pickem_result", {
      p_game_id: gameId,
      p_slate_game_id: slateIds[0],
      p_result: "tie",
    });
    expect(error?.message).toContain("BAD_RESULT");
  });
});

describe("any order — nothing waits on the row above it", () => {
  it("records the LAST slate game first, and the rest out of order", async () => {
    // The assertion that fails against an implementation assuming sequence.
    // Deliberately starts at the end of the slate: a build that required order
    // would refuse here, and a suite that entered 0,1,2,3 would never find out.
    const order = [3, 1, 0, 2];
    const outcomes = ["home", "push", "away", "cancelled"] as const;
    for (const [n, idx] of order.entries()) {
      const { error } = await setResult(slateIds[idx], outcomes[n]);
      expect(error, `slot ${idx}`).toBeNull();
    }
    expect(await resultsOf()).toEqual(["away", "push", "cancelled", "home"]);
  });

  it("a gap in the middle is a legitimate state", async () => {
    await setResult(slateIds[0], "away");
    await setResult(slateIds[3], "home");
    expect(await resultsOf()).toEqual(["away", null, null, "home"]);
  });
});

describe("the completeness gate — §4 and §6.1", () => {
  async function addMatch(a: string | null, b: string | null, order = 0) {
    await ctx.admin.from("game_matches").insert({
      id: genId("gm"),
      game_id: gameId,
      match_number: order + 1,
      display_order: order,
      side_a: a ? { type: "user", id: a } : null,
      side_b: b ? { type: "user", id: b } : null,
      status: "pending",
    });
  }

  /**
   * ── THE PAIRING GATE IS GONE (migration 167) ──────────────────────────────
   *
   * Three cases here used to assert that a result was REFUSED until every match
   * had both sides. The rule was wrong, not merely inconvenient: a slate game's
   * result is a fact about the WORLD, and whether Alabama covered does not
   * depend on who has been paired against whom.
   *
   * The stated justification was that "the X/N split has an N of zero". It does
   * not follow — entering a result scores every SHEET, which works with no
   * matches at all; only the match TOTALS need matches, and those derive at
   * read time. An unpaired match has no total yet, which the board renders as a
   * display state rather than an error.
   *
   * So the three refusal cases become one acceptance case per shape. They are
   * kept as a set rather than collapsed to one, because the old gate fired only
   * under `individual_matches` — a suite that checked team totals alone would
   * pass against the gate still being there.
   */
  it.each([
    ["team totals, no matches", "team_totals" as const, 0],
    ["individual matches, no matches", "individual_matches" as const, 0],
    ["individual matches, a HALF-FILLED match", "individual_matches" as const, 1],
  ])("records a result with %s", async (_label, shape, halfFilled) => {
    await rollUp(shape);
    if (halfFilled > 0) {
      await addMatch(owner, member, 0);
      await addMatch(planner, null, 1);
    }
    const { error } = await setResult(slateIds[0], "away");
    expect(error).toBeNull();
    expect((await resultsOf())[0]).toBe("away");
  });

  it("still records once every match IS complete — the gate's removal took nothing", async () => {
    await rollUp("individual_matches");
    await addMatch(owner, member, 0);
    const { error } = await setResult(slateIds[0], "away");
    expect(error).toBeNull();
  });

  it("CLEARING is never gated — undo must not depend on the mistake's condition", async () => {
    // Record while complete, then break the matches, then clear. A gate on the
    // clear path would strand the runner with a result they cannot remove.
    await rollUp("individual_matches");
    await addMatch(owner, member, 0);
    await setResult(slateIds[0], "away");
    await addMatch(planner, null, 1);

    const { error } = await setResult(slateIds[0], null);
    expect(error).toBeNull();
    expect((await resultsOf())[0]).toBeNull();
  });
});

describe("editable while active, frozen at finalize — §6.2", () => {
  it("a result can be changed while the game is active", async () => {
    await setResult(slateIds[0], "away");
    const { error } = await setResult(slateIds[0], "home");
    expect(error).toBeNull();
    expect((await resultsOf())[0]).toBe("home");
  });

  it("REFUSES once the game is LOCKED, and names Correct scores", async () => {
    /**
     * The gate is `complete AND NOT corrections_open` (migration 167) — golf's
     * `gameLockState.isLocked`, read the same way so the two cannot drift.
     *
     * It used to be `complete` alone, and its message sent the runner to Reset,
     * which clears every result in the game. An instruction that works and
     * costs everything, for somebody fixing a typo.
     */
    await setResult(slateIds[0], "away");
    await ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId);

    const { error } = await setResult(slateIds[0], "home");
    expect(error?.message).toContain("GAME_LOCKED");
    expect(error?.message).not.toContain("reset");
    expect((await resultsOf())[0]).toBe("away");
  });

  it("a LOCKED game refuses a CLEAR as well", async () => {
    // A finalized result is history — clearing one rewrites a standing as much
    // as changing it does.
    await setResult(slateIds[0], "away");
    await ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId);
    const { error } = await setResult(slateIds[0], null);
    expect(error?.message).toContain("GAME_LOCKED");
  });

  it("CORRECTING reopens it — the whole reason the gate reads two columns", async () => {
    /**
     * THE CASE THAT MAKES THE GATE A GATE RATHER THAN A WALL, and the one a
     * status-only build cannot pass.
     *
     * A finalized game with corrections open is editable again, and re-locking
     * closes it. Without this pair, "refuses when complete" is satisfied by the
     * old rule — which is what shipped, and which had no way back except Reset.
     */
    await setResult(slateIds[0], "away");
    await ctx.admin
      .from("games")
      .update({ status: "complete", corrections_open: true })
      .eq("id", gameId);

    expect((await setResult(slateIds[0], "home")).error).toBeNull();
    expect((await resultsOf())[0]).toBe("home");

    // ...and closing corrections locks it again.
    await ctx.admin.from("games").update({ corrections_open: false }).eq("id", gameId);
    expect((await setResult(slateIds[0], "away")).error?.message).toContain("GAME_LOCKED");
  });
});

describe("the first result is the freeze boundary — §6.3", () => {
  it("_pickem_has_results turns TRUE on the first slate outcome", async () => {
    // Migration 157 wrote this predicate before pick'em could record anything,
    // so it read only game_results / decided matches / a finished game. Left
    // that way it would answer false through the whole of Run and neither
    // freeze would ever fire.
    const before = await ctx.admin.rpc("_pickem_has_results", { p_game_id: gameId });
    expect(before.data).toBe(false);

    await setResult(slateIds[2], "push");

    const after = await ctx.admin.rpc("_pickem_has_results", { p_game_id: gameId });
    expect(after.data).toBe(true);
  });

  it("a PUSH counts as a result for the freeze, not just a win", async () => {
    // It is a recorded fact about a game that happened. A predicate that only
    // saw away/home would leave picks reopenable after a push.
    await setResult(slateIds[0], "cancelled");
    const { data } = await ctx.admin.rpc("_pickem_has_results", { p_game_id: gameId });
    expect(data).toBe(true);
  });

  it("the scoring settings freeze on the same predicate", async () => {
    // One boundary, and this is what proves the Run column feeds it.
    await setResult(slateIds[0], "away");
    const { error } = await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: (await ctx.caller().games.configHash({ tripId, gameId })).hash,
      payload: {
        name: "Run",
        rulesForToday: null,
        scoringEnabled: false,
        pointsTotal: 6,
        pointsDistribution: null,
        courseId: null,
        backCourseId: null,
        scorecardSchema: null,
        pickem: { rollUp: "team_totals", useConfidence: false },
      } as never,
    }).then(
      () => ({ error: null as { message: string } | null }),
      (e: { message: string }) => ({ error: e })
    );
    expect(error?.message).toContain("frozen");
  });

  it("picks cannot reopen after the first result", async () => {
    // `save_pickem_config`'s slate arm is gated on picks being OPEN, and the
    // settings arm on this predicate. Reopening means unlocking, which is what
    // this checks: a re-pick of a game whose outcome is known is not a pick.
    await setResult(slateIds[0], "away");
    const { error } = await ctx.authedClient("owner").rpc("save_pickem_config", {
      p_game_id: gameId,
      p_payload: { settings: { useConfidence: true } },
    });
    expect(error?.message).toContain("PICKEM_SCORED");
  });
});

describe("who may run it", () => {
  it("a DELEGATE can enter results", async () => {
    // The test that fails against a gate excluding delegates. `member` is a
    // plain trip Member granted delegate on THIS game — the model migration 158
    // confirmed, and the seat Phase 4's `game_matches_select` bug was invisible
    // from.
    await ctx.caller().games.addOrganizer({ tripId, gameId, userId: member });
    const { error } = await setResult(slateIds[1], "home", "member");
    expect(error).toBeNull();
    expect((await resultsOf())[1]).toBe("home");
    await ctx.admin.from("game_delegates").delete().eq("game_id", gameId);
  });

  it("an ORGANIZER can enter results", async () => {
    const { error } = await setResult(slateIds[1], "away", "planner");
    expect(error).toBeNull();
  });

  it("a plain MEMBER with no grant cannot", async () => {
    const { error } = await setResult(slateIds[2], "away", "member");
    expect(error?.message).toContain("NOT_AUTHORIZED");
    expect((await resultsOf())[2]).toBeNull();
  });
});
