import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `save_pickem_config` and `set_pickem_phase` (migration 148).
 *
 * The case that matters most here is **reopen-then-save keeps the picks**. A
 * clean-replace of the slate — which is what `save_game_config` does to
 * `game_matches`, and therefore the obvious thing to copy — would cascade every
 * pick away through `pickem_picks`' composite FK. While `building` that is
 * invisible, because no picks can exist yet; it only bites after Reopen the
 * slate, on a game with a full field of submitted sheets, which is the one
 * moment nobody would be running this test by hand.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;

const slateItem = (over: Record<string, unknown> = {}) => ({
  id: genId("s"),
  awayTeam: "Alabama",
  homeTeam: "Georgia",
  spread: "-3.5",
  kickoff: "Thu 7:30p",
  note: null,
  multiplier: 1,
  ...over,
});

describe("save_pickem_config / set_pickem_phase", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Slate Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    gameId = genId("slategame");
    await ctx.admin
      .from("games")
      .insert({ id: gameId, trip_id: tripId, game_type_id: "gtt_pickem", name: "Pick'em" });
  }, 60_000);

  afterEachReset();
  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  function afterEachReset() {
    beforeEach(async () => {
      await ctx.admin.from("pickem_picks").delete().eq("game_id", gameId);
      await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
      await ctx.admin.from("pickem_games").delete().eq("game_id", gameId);
    });
  }

  const save = (payload: Record<string, unknown>, role: "owner" | "member" = "owner") =>
    ctx.authedClient(role).rpc("save_pickem_config", { p_game_id: gameId, p_payload: payload });

  const phase = (action: string, role: "owner" | "member" = "owner") =>
    ctx
      .authedClient(role)
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: action });

  const readSlate = async () => {
    const { data } = await ctx.admin
      .from("pickem_slate_games")
      .select("id, display_order, away_team, home_team, spread, kickoff, note, multiplier")
      .eq("game_id", gameId)
      .order("display_order");
    return data ?? [];
  };

  // ── writing a slate ──────────────────────────────────────────────────────

  it("writes a slate and derives display_order from array position", async () => {
    const a = slateItem({ awayTeam: "Alabama" });
    const b = slateItem({ awayTeam: "Ohio St", homeTeam: "Michigan", spread: null, kickoff: null });
    const { error } = await save({ slate: [a, b] });
    expect(error).toBeNull();

    const rows = await readSlate();
    expect(rows.map((r) => r.away_team)).toEqual(["Alabama", "Ohio St"]);
    // Position, not a client-supplied ordinal — two rows cannot claim one slot.
    expect(rows.map((r) => r.display_order)).toEqual([0, 1]);
    // Empty strings become NULL rather than being stored as "".
    expect(rows[1].spread).toBeNull();
    expect(rows[1].kickoff).toBeNull();
  });

  it("reordering the array reorders the slate, keeping ids", async () => {
    const a = slateItem({ awayTeam: "A" });
    const b = slateItem({ awayTeam: "B" });
    await save({ slate: [a, b] });
    await save({ slate: [b, a] });

    const rows = await readSlate();
    expect(rows.map((r) => r.away_team)).toEqual(["B", "A"]);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("defaults a missing multiplier to 1 — setting nothing produces a normal game", async () => {
    const bare = slateItem();
    delete (bare as Record<string, unknown>).multiplier;
    await save({ slate: [bare] });
    expect(Number((await readSlate())[0].multiplier)).toBe(1);
  });

  it("stores a real multiplier, and refuses a non-positive one", async () => {
    await save({ slate: [slateItem({ multiplier: 3 })] });
    expect(Number((await readSlate())[0].multiplier)).toBe(3);

    const { error } = await save({ slate: [slateItem({ multiplier: 0 })] });
    expect(error?.message).toContain("BAD_MULTIPLIER");
  });

  // ── the decision this migration turns on ─────────────────────────────────

  it("REOPEN THEN SAVE KEEPS THE PICKS on games that survived", async () => {
    // The whole reason the slate is upserted rather than clean-replaced.
    const keep = slateItem({ awayTeam: "Survivor" });
    const drop = slateItem({ awayTeam: "Removed" });
    await save({ slate: [keep, drop] });
    await phase("open");

    // A participant's sheet, written the way the app will write it.
    await ctx.admin.from("pickem_picks").insert([
      { id: genId("p"), game_id: gameId, slate_game_id: keep.id, user_id: ctx.getUser("member").id, pick: "away", confidence: 2 },
      { id: genId("p"), game_id: gameId, slate_game_id: drop.id, user_id: ctx.getUser("member").id, pick: "home", confidence: 1 },
    ]);

    // Locking is now the whole of "let me edit this": the slate is frozen only
    // while picks are OPEN, and locking on its own destroys nothing.
    await phase("lock");
    // The runner edits the slate: keeps one game, drops the other, adds a third.
    const added = slateItem({ awayTeam: "Added" });
    const { error } = await save({ slate: [keep, added] });
    expect(error).toBeNull();

    const { data: picks } = await ctx.admin
      .from("pickem_picks").select("slate_game_id, pick, confidence").eq("game_id", gameId);
    // The surviving game's pick is INTACT — same winner.
    //
    // The RANK is deliberately gone: migration 150 clears every confidence on
    // reopen, because 1..N no longer covers this slate once a game is added or
    // removed (HANDOFF §7.2). This assertion read `confidence: 2` when it was
    // written, which was correct then and is an assertion of the OLD behaviour
    // now — the exact thing CLAUDE.md's "grep tests for the old behaviour before
    // pushing" rule is about. It was caught by running the suite rather than by
    // that grep, which is the slower of the two ways to find it.
    expect(picks).toEqual([{ slate_game_id: keep.id, pick: "away", confidence: null }]);
    // ...and the removed game took its own pick with it, which is the only
    // deletion that should have happened.
    expect((picks ?? []).some((p) => p.slate_game_id === drop.id)).toBe(false);
  });

  it("an EDIT to a surviving game keeps its picks too — the id is what matters", async () => {
    // The subtler half: a clean-replace that reused ids would pass the test
    // above. This one edits the row's CONTENT, which is what a runner fixing a
    // typo after a reopen actually does.
    const g = slateItem({ awayTeam: "Bama", spread: "-3.5" });
    await save({ slate: [g] });
    await phase("open");
    await ctx.admin.from("pickem_picks").insert({
      id: genId("p"), game_id: gameId, slate_game_id: g.id,
      user_id: ctx.getUser("member").id, pick: "away", confidence: 1,
    });
    await phase("lock");

    await save({ slate: [{ ...g, awayTeam: "Alabama", spread: "-4.5", multiplier: 2 }] });

    const rows = await readSlate();
    expect(rows[0].away_team).toBe("Alabama");
    expect(rows[0].spread).toBe("-4.5");
    expect(Number(rows[0].multiplier)).toBe(2);
    const { count } = await ctx.admin
      .from("pickem_picks").select("*", { count: "exact", head: true }).eq("game_id", gameId);
    expect(count).toBe(1);
  });

  // ── the lock ─────────────────────────────────────────────────────────────

  it("refuses a slate edit once picks are open, and allows it again after reopen", async () => {
    await save({ slate: [slateItem()] });
    await phase("open");

    const locked = await save({ slate: [slateItem()] });
    expect(locked.error?.message).toContain("SLATE_LOCKED");

    // The settings ride the same lock, for the same reason.
    const lockedSettings = await save({ settings: { useConfidence: false } });
    expect(lockedSettings.error?.message).toContain("SLATE_LOCKED");

    await phase("lock");
    expect((await save({ settings: { useConfidence: false } })).error).toBeNull();
  });

  it("saves the two scoring settings", async () => {
    await save({ settings: { rollUp: "individual_matches", useConfidence: false } });
    const { data } = await ctx.admin
      .from("pickem_games").select("roll_up, use_confidence").eq("game_id", gameId).single();
    expect(data).toEqual({ roll_up: "individual_matches", use_confidence: false });
  });

  it("an absent key leaves that half alone — the two are independently savable", async () => {
    await save({ settings: { rollUp: "individual_matches", useConfidence: false } });
    await save({ slate: [slateItem()] });
    const { data } = await ctx.admin
      .from("pickem_games").select("roll_up, use_confidence").eq("game_id", gameId).single();
    expect(data).toEqual({ roll_up: "individual_matches", use_confidence: false });
    expect(await readSlate()).toHaveLength(1);
  });

  // ── phase transitions ────────────────────────────────────────────────────

  it("REFUSES to open picks on an empty slate", async () => {
    // "Picks open soon" with nothing behind it is a dead end for sixteen people,
    // and the runner cannot see it from his own screen — he can read the slate
    // whether or not it has rows.
    const { error } = await phase("open");
    expect(error?.message).toContain("EMPTY_SLATE");
  });

  it("open stamps ONE column, lock stamps another, unlock clears only that", async () => {
    // Migration 156. Each action writes exactly the column it is named after.
    const clock = async () => {
      const { data } = await ctx.admin
        .from("pickem_games")
        .select("picks_opened_at, picks_deadline, picks_locked_at")
        .eq("game_id", gameId)
        .single();
      return data!;
    };

    await save({ slate: [slateItem()] });

    // A deadline set BEFORE picks open, through the function that owns it.
    const deadline = new Date(Date.now() + 3_600_000).toISOString();
    await ctx
      .authedClient("owner")
      .rpc("set_pickem_deadline", { p_game_id: gameId, p_deadline: deadline });

    expect((await phase("open")).error).toBeNull();
    let c = await clock();
    expect(c.picks_opened_at).not.toBeNull();
    expect(c.picks_locked_at).toBeNull();
    // THE REGRESSION THIS TEST NOW CARRIES: `open` used to write
    // `picks_deadline = p_deadline` with no COALESCE, and every caller passed
    // null — so opening silently wiped the deadline it was supposed to honour.
    expect(new Date(c.picks_deadline as string).getTime()).toBe(new Date(deadline).getTime());

    await phase("lock");
    c = await clock();
    expect(c.picks_locked_at).not.toBeNull();

    await phase("unlock");
    c = await clock();
    expect(c.picks_locked_at).toBeNull();
    // `picks_opened_at` SURVIVES. Under `reopen` it was nulled, so re-opening
    // re-stamped a fresh now() and the original publish time was lost.
    expect(c.picks_opened_at).not.toBeNull();
    expect(new Date(c.picks_deadline as string).getTime()).toBe(new Date(deadline).getTime());
  });

  it("rejects an unknown action rather than silently doing nothing", async () => {
    const { error } = await phase("publish");
    expect(error?.message).toContain("BAD_ACTION");
  });

  // ── authorisation ────────────────────────────────────────────────────────

  it("a plain member cannot write the slate or move the phase", async () => {
    // Through the RPC, not through a policy — `assert_game_edit` is the gate,
    // and these functions are SECURITY DEFINER so RLS would not stop them.
    const saved = await save({ slate: [slateItem()] }, "member");
    expect(saved.error?.message).toContain("NOT_AUTHORIZED");

    await save({ slate: [slateItem()] });
    const moved = await phase("open", "member");
    expect(moved.error?.message).toContain("NOT_AUTHORIZED");
  });
});
