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

  // ── building a slate one game at a time (write-on-change) ────────────────
  /**
   * #1204: adding a matchup ejected the runner from the modal, so a slate was
   * built by reopening it between every addition — reported both as "it closes
   * the picks modal immediately" and, counted a different way, as a cap at five
   * games.
   *
   * The dismissal lived in the client and is fixed there. What these pin is the
   * half underneath it: that the runner's ACTUAL sequence — one save per added
   * game, each carrying the whole slate — accumulates. `PickemSlateModal.mutate`
   * sends `onSave({ slate: next })` where `next` is the entire array, so these
   * send cumulative arrays rather than deltas, which is what the real caller
   * sends. A delta fixture would be measuring an endpoint the app never calls.
   */

  it("adds accumulate across successive saves — three in a row, all three persist", async () => {
    const a = slateItem({ awayTeam: "Alabama", homeTeam: "Georgia" });
    const b = slateItem({ awayTeam: "Ohio St", homeTeam: "Michigan" });
    const c = slateItem({ awayTeam: "Texas", homeTeam: "Oklahoma" });

    // Three, not one: one passes against a build that loses everything after the
    // first, and against one that only ever stores the most recent game.
    for (const slate of [[a], [a, b], [a, b, c]]) {
      const { error } = await save({ slate });
      expect(error).toBeNull();
    }

    const rows = await readSlate();
    expect(rows.map((r) => r.away_team)).toEqual(["Alabama", "Ohio St", "Texas"]);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(rows.map((r) => r.display_order)).toEqual([0, 1, 2]);
  });

  it("keeps accumulating past five and past a full-size slate — there is no cap", async () => {
    /**
     * Five and six are named because those are the counts the bug was reported
     * at; sixteen because that is a real slate, and nobody had built one at size
     * before this. The RPC's own ceiling is `.max(200)` in the zod input, so if
     * anything here refuses it is a limit nobody meant to write.
     */
    const games = Array.from({ length: 16 }, (_, i) =>
      slateItem({ awayTeam: `Away ${i + 1}`, homeTeam: `Home ${i + 1}` })
    );

    for (let n = 1; n <= games.length; n++) {
      const { error } = await save({ slate: games.slice(0, n) });
      expect(error, `save refused at game ${n}`).toBeNull();
      // Asserted EVERY step, not only at the end. A cap that silently dropped
      // the overflow would leave a correct-looking prefix, and a final-count
      // check alone cannot tell "16 stored" from "5 stored twelve times".
      const seen = await readSlate();
      expect(seen.length, `stored count after adding game ${n}`).toBe(n);
    }

    const rows = await readSlate();
    expect(rows.map((r) => r.away_team)).toEqual(games.map((g) => g.awayTeam));
  }, 60_000);

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

  // ── which slate changes destroy a ranking (#1150, migration 174) ──────────

  /**
   * The asymmetry migration 174 introduced, and why it is not arbitrary.
   *
   * 166 made a PARTIAL sheet legal: ranks must be within 1..N and distinct
   * (166:130-143), and exactly-1..N is demanded only when the sheet is COMPLETE
   * (166:154-159). So growing the slate leaves every existing rank valid — it is
   * a partial sheet now — while shrinking it can strand a rank above the new N.
   *
   * Both directions are asserted here because only asserting the ADD would pass
   * against a build that stopped clearing altogether, which is the tempting
   * over-correction and a worse bug than the one being fixed: it would leave an
   * out-of-range rank in the table and move the corruption downstream.
   */

  /** A locked game with one complete 4-game sheet, ranks 1..4 by slate order. */
  const lockedSheetOfFour = async () => {
    const games = [0, 1, 2, 3].map((i) => slateItem({ awayTeam: `Away${i}` }));
    await save({ slate: games });
    await phase("open");
    await ctx.admin.from("pickem_picks").insert(
      games.map((g, i) => ({
        id: genId("p"),
        game_id: gameId,
        slate_game_id: g.id,
        user_id: ctx.getUser("member").id,
        pick: "away",
        confidence: i + 1,
      }))
    );
    await phase("lock");
    return games;
  };

  /** slate_game_id -> confidence, so each rank is asserted by name. */
  const ranks = async () => {
    const { data } = await ctx.admin
      .from("pickem_picks")
      .select("slate_game_id, confidence")
      .eq("game_id", gameId);
    return Object.fromEntries((data ?? []).map((r) => [r.slate_game_id, r.confidence]));
  };

  it("an ADD after the lock keeps every ranking — #1150", async () => {
    const games = await lockedSheetOfFour();

    // The whole bug, in one call: the runner adds the late game somebody asked
    // about, on a surface they are meant to use, with picks already locked.
    const late = slateItem({ awayTeam: "Late", homeTeam: "Addition" });
    const { error } = await save({ slate: [...games, late] });
    expect(error).toBeNull();

    // Each rank by VALUE, not `not.toBeNull()` — a build that rewrote every
    // confidence to 1 would pass a null check and be just as wrong.
    expect(await ranks()).toEqual({
      [games[0].id]: 1,
      [games[1].id]: 2,
      [games[2].id]: 3,
      [games[3].id]: 4,
    });

    // And the sheet is still one 166 would accept: 4 picks against a slate of
    // 5, every rank in 1..5, none repeated, completeness not required.
    const { count } = await ctx.admin
      .from("pickem_slate_games")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(count).toBe(5);
  });

  it("a REMOVE after the lock still clears them — the guard against over-narrowing", async () => {
    const games = await lockedSheetOfFour();

    // Dropping game index 1 strands its rank, and leaves rank 4 above the new
    // N=3. That sheet is genuinely invalid, so today's clear is kept.
    const { error } = await save({ slate: [games[0], games[2], games[3]] });
    expect(error).toBeNull();

    expect(await ranks()).toEqual({
      [games[0].id]: null,
      [games[2].id]: null,
      [games[3].id]: null,
    });
  });

  it("a REPLACE clears too — it removes an id, whatever else it also does", async () => {
    // Not a third arm. Swap lands in the clear arm because something LEFT, and
    // this pins that rather than leaving it to be inferred from the two above.
    const games = await lockedSheetOfFour();
    const swapped = slateItem({ awayTeam: "Swapped" });

    const { error } = await save({ slate: [games[0], games[1], games[2], swapped] });
    expect(error).toBeNull();

    const r = await ranks();
    expect(r[games[0].id]).toBeNull();
    expect(r[games[1].id]).toBeNull();
    expect(r[games[2].id]).toBeNull();
  });

  it("a REORDER and an EDIT still keep them — 174 narrowed the clear, it did not widen it", async () => {
    // 157 already had these free, and the set-difference must not regress them.
    const games = await lockedSheetOfFour();

    const { error } = await save({
      slate: [
        { ...games[3], awayTeam: "Renamed", spread: "-7.5" },
        games[2],
        games[1],
        games[0],
      ],
    });
    expect(error).toBeNull();

    expect(await ranks()).toEqual({
      [games[0].id]: 1,
      [games[1].id]: 2,
      [games[2].id]: 3,
      [games[3].id]: 4,
    });
  });

  // ── the lock ─────────────────────────────────────────────────────────────

  it("refuses a SLATE edit once picks are open, and allows it again once locked", async () => {
    await save({ slate: [slateItem()] });
    await phase("open");

    const locked = await save({ slate: [slateItem()] });
    expect(locked.error?.message).toContain("SLATE_LOCKED");

    await phase("lock");
    expect((await save({ slate: [slateItem()] })).error).toBeNull();
  });

  it("but the SETTINGS are NOT frozen by picks opening — they wait for a result", async () => {
    // The boundary migration 157 moved, and the assertion that fails against the
    // old model. The settings used to ride the slate's lock ("for the same
    // reason", said the test this replaces) — which was the thing that made one
    // atomic save impossible: `points_total` was deliberately carved out of that
    // freeze (152) while these two sat inside it, so a single Save could not
    // honour both boundaries at once.
    //
    // Until something is scored, changing how scoring works rewrites nothing.
    await save({ slate: [slateItem()] });
    await phase("open");

    expect((await save({ settings: { useConfidence: false } })).error).toBeNull();
    const { data } = await ctx.admin
      .from("pickem_games")
      .select("use_confidence")
      .eq("game_id", gameId)
      .single();
    expect(data!.use_confidence).toBe(false);
  });

  it("the settings freeze at the first RESULT, whichever writer is used", async () => {
    // One boundary, both doors. `set_pickem_points_total` writes the same column
    // `save_game_config` refuses after a result, so without its own check it
    // would be a hole straight through the freeze.
    await save({ slate: [slateItem()] });
    await ctx.admin.from("game_results").insert({
      id: `gr-${gameId}`,
      game_id: gameId,
      entity_type: "user",
      entity_id: ctx.getUser("owner").id,
      raw_score: 1,
      position: 1,
    });

    const settings = await save({ settings: { useConfidence: false } });
    expect(settings.error?.message).toContain("PICKEM_SCORED");

    const total = await ctx
      .authedClient("owner")
      .rpc("set_pickem_points_total", { p_game_id: gameId, p_total: 9 });
    expect(total.error?.message).toContain("PICKEM_SCORED");

    await ctx.admin.from("game_results").delete().eq("game_id", gameId);
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
