import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `save_pickem_matches` (migration 154) — pick'em writing into `game_matches`.
 *
 * The point of sharing that table is that every existing consumer reads pick'em
 * rows without knowing they are pick'em, so the assertions below check the
 * STORED SHAPE against what `matches.setPairings` writes, not just that rows
 * appeared.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let owner: string;
let member: string;

describe("save_pickem_matches", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Matches Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    owner = ctx.getUser("owner").id;
    member = ctx.getUser("member").id;
    gameId = genId("matchgame");
    await ctx.admin
      .from("games")
      .insert({ id: gameId, trip_id: tripId, game_type_id: "gtt_pickem", name: "Pick'em" });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  beforeEach(async () => {
    await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
  });

  const save = (pairs: unknown, role: "owner" | "member" = "owner") =>
    ctx.authedClient(role).rpc("save_pickem_matches", { p_game_id: gameId, p_pairs: pairs });

  const readMatches = async () => {
    const { data } = await ctx.admin
      .from("game_matches")
      .select("display_order, match_number, side_a, side_b, status")
      .eq("game_id", gameId)
      .order("display_order");
    return data ?? [];
  };

  it("writes sides in the SAME SHAPE as matches.setPairings", async () => {
    // `{type:'user', id}` is what makes MatchSides, the divisor and the guest
    // merge read these rows without knowing the format. A different shape here
    // would be invisible until one of them silently skipped pick'em.
    expect((await save([{ a: owner, b: member }])).error).toBeNull();
    const rows = await readMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0].side_a).toEqual({ type: "user", id: owner });
    expect(rows[0].side_b).toEqual({ type: "user", id: member });
    expect(rows[0].status).toBe("pending");
  });

  it("keeps an UNPAIRED row, with the empty slot null", async () => {
    // Someone sitting out is a real committed state (§4), not a draft artefact.
    expect((await save([{ a: owner, b: member }, { a: null, b: null }, { a: null, b: null }])).error)
      .toBeNull();
    const rows = await readMatches();
    expect(rows).toHaveLength(3);
    expect(rows[1].side_a).toBeNull();
    expect(rows[1].side_b).toBeNull();
  });

  it("numbers and orders rows by position", async () => {
    await save([{ a: owner, b: member }, { a: null, b: null }]);
    const rows = await readMatches();
    expect(rows.map((r) => r.display_order)).toEqual([0, 1]);
    expect(rows.map((r) => r.match_number)).toEqual([1, 2]);
  });

  it("CLEAN-REPLACES — re-saving does not accumulate rows", async () => {
    await save([{ a: owner, b: member }, { a: null, b: null }]);
    await save([{ a: member, b: owner }]);
    const rows = await readMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0].side_a).toEqual({ type: "user", id: member });
  });

  // ── the guard that matters ───────────────────────────────────────────────

  it("REFUSES to re-pair once a match has a RESULT", async () => {
    // Re-pairing a decided match moves a recorded result onto different people,
    // and nothing about the row looks wrong afterwards. There is no correct
    // automatic answer, so it is refused rather than merged.
    await save([{ a: owner, b: member }]);
    // 'a_win', not an invented value: game_matches CHECKs result IN
    // ('a_win','b_win','halve'). The first version used 'side_a', the UPDATE was
    // refused, supabase-js did not throw, and the guard was never exercised —
    // the test passed its own setup rather than the behaviour. Asserted now.
    const setup = await ctx.admin
      .from("game_matches").update({ result: "a_win" }).eq("game_id", gameId);
    expect(setup.error).toBeNull();

    const { error } = await save([{ a: member, b: owner }]);
    expect(error?.message).toContain("MATCH_DECIDED");

    // ...and the decided row is untouched by the refusal.
    const rows = await readMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0].side_a).toEqual({ type: "user", id: owner });
  });

  it("refuses on status='complete' too, not only a set result", async () => {
    await save([{ a: owner, b: member }]);
    await ctx.admin.from("game_matches").update({ status: "complete" }).eq("game_id", gameId);
    expect((await save([{ a: member, b: owner }])).error?.message).toContain("MATCH_DECIDED");
  });

  it("refuses a person appearing TWICE — one sheet, one match", async () => {
    // The client evicts on assign; this is the backstop for a direct caller,
    // and it matters because a duplicate makes one sheet decide two matches.
    const { error } = await save([
      { a: owner, b: member },
      { a: owner, b: null },
    ]);
    expect(error?.message).toContain("DUPLICATE_PLAYER");
  });

  it("...including across sides", async () => {
    const { error } = await save([
      { a: owner, b: member },
      { a: null, b: owner },
    ]);
    expect(error?.message).toContain("DUPLICATE_PLAYER");
  });

  // ── participants follow the pairing ──────────────────────────────────────

  it("creates a participant row per paired person", async () => {
    await save([{ a: owner, b: member }]);
    const { data } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect(new Set((data ?? []).map((r) => r.user_id))).toEqual(new Set([owner, member]));
  });

  it("drops the participant row of someone removed from the field", async () => {
    await save([{ a: owner, b: member }]);
    await save([{ a: owner, b: null }]);
    const { data } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect((data ?? []).map((r) => r.user_id)).toEqual([owner]);
  });

  it("BUT NEVER their sheet — being unpaired must not erase what they submitted", async () => {
    // `pickem_picks` keys off the slate and the user, never off participation.
    // Someone left out of this round may be paired in the next save, and losing
    // their picks in between would be unrecoverable.
    const slateId = genId("sg");
    await ctx.admin.from("pickem_games").upsert({ game_id: gameId });
    await ctx.admin.from("pickem_slate_games").insert({
      id: slateId, game_id: gameId, display_order: 0, away_team: "A", home_team: "H",
    });
    await ctx.admin.from("pickem_picks").insert({
      id: genId("p"), game_id: gameId, slate_game_id: slateId,
      user_id: member, pick: "away", confidence: 1,
    });

    await save([{ a: owner, b: member }]);
    await save([{ a: owner, b: null }]); // member dropped from the field

    const { count } = await ctx.admin
      .from("pickem_picks").select("*", { count: "exact", head: true })
      .eq("game_id", gameId).eq("user_id", member);
    expect(count).toBe(1);

    await ctx.admin.from("pickem_picks").delete().eq("game_id", gameId);
    await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  });

  // ── authorisation, and the lock ──────────────────────────────────────────

  it("a plain member cannot set the matches", async () => {
    expect((await save([{ a: owner, b: member }], "member")).error?.message)
      .toContain("NOT_AUTHORIZED");
  });

  it("PAIRING IS NOT GATED ON THE LOCK — before, during and after all work", async () => {
    // Spec §1 deletes the fairness rule. There is no strategic reason to pick
    // differently against one opponent than another, and with confidence off it
    // is meaningless. What survives is a REVEAL rule, enforced by the read.
    await ctx.admin.from("pickem_games").upsert({ game_id: gameId });

    // building
    await ctx.admin.from("pickem_games")
      .update({ picks_opened_at: null, picks_locked_at: null }).eq("game_id", gameId);
    expect((await save([{ a: owner, b: member }])).error).toBeNull();

    // picks open
    await ctx.admin.from("pickem_games")
      .update({ picks_opened_at: new Date().toISOString() }).eq("game_id", gameId);
    expect((await save([{ a: member, b: owner }])).error).toBeNull();

    // locked
    await ctx.admin.from("pickem_games")
      .update({ picks_locked_at: new Date().toISOString() }).eq("game_id", gameId);
    expect((await save([{ a: owner, b: member }])).error).toBeNull();

    await ctx.admin.from("pickem_games").delete().eq("game_id", gameId);
  });
});
