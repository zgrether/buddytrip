import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * `save_pickem_picks` and the reopen-clears-rankings half of migration 150.
 *
 * ── Driven through a real JWT, never through tRPC ──────────────────────────
 * Same reason as `pickemPicksPolicy.rls.test.ts`: this RPC is `SECURITY
 * INVOKER`, so RLS is the gate, and a test that goes through the callers cannot
 * see a gate wider than its callers. Everything below is `ctx.authedClient(...)`
 * → PostgREST.
 *
 * ── The case this whole procedure exists for ───────────────────────────────
 * "a rank SWAP saves" is not one test among several. `uq_pickem_picks_confidence`
 * is a PARTIAL unique index and therefore can never be deferred, so the obvious
 * implementation — one multi-row `.upsert()` — raises 23505 mid-statement on the
 * commonest edit a person makes. The test below proves the naive path fails
 * BEFORE proving the RPC succeeds, because otherwise "the RPC works" is
 * indistinguishable from "the RPC was unnecessary".
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let slateIds: string[];

const SLATE_SIZE = 4;

describe("save_pickem_picks (migration 150)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Sheet Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    gameId = genId("sheetgame");
    await ctx.admin
      .from("games")
      .insert({ id: gameId, trip_id: tripId, game_type_id: "gtt_pickem", name: "Pick'em" });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  /** A fresh slate + a fresh clock before every case, so no test inherits
   *  another's ranking (which is exactly the state a unique index punishes). */
  beforeEach(async () => {
    await ctx.admin.from("pickem_picks").delete().eq("game_id", gameId);
    await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
    await ctx.admin.from("pickem_games").delete().eq("game_id", gameId);

    slateIds = Array.from({ length: SLATE_SIZE }, () => genId("sg"));
    await ctx.admin.from("pickem_slate_games").insert(
      slateIds.map((id, i) => ({
        id,
        game_id: gameId,
        display_order: i,
        away_team: `Away${i}`,
        home_team: `Home${i}`,
      }))
    );
    await ctx.admin.from("pickem_games").insert({
      game_id: gameId,
      picks_opened_at: new Date(Date.now() - 3_600_000).toISOString(),
      use_confidence: true,
    });
  });

  const sheet = (over: Partial<Record<number, { pick?: string; confidence?: number }>> = {}) =>
    slateIds.map((id, i) => ({
      slateGameId: id,
      pick: over[i]?.pick ?? "home",
      confidence: over[i]?.confidence ?? SLATE_SIZE - i,
    }));

  const save = (picks: unknown, role: "owner" | "member" | "outsider" = "member") =>
    ctx.authedClient(role).rpc("save_pickem_picks", { p_game_id: gameId, p_picks: picks });

  const readSheet = async (role: "owner" | "member" = "member") => {
    const { data } = await ctx.admin
      .from("pickem_picks")
      .select("slate_game_id, pick, confidence")
      .eq("game_id", gameId)
      .eq("user_id", ctx.getUser(role).id);
    const byId = new Map((data ?? []).map((r) => [r.slate_game_id, r]));
    return slateIds.map((id) => byId.get(id) ?? null);
  };

  // ── the reason the procedure exists ──────────────────────────────────────

  it("A RANK SWAP saves — and the naive upsert it replaces does not", async () => {
    expect((await save(sheet())).error).toBeNull();

    // FIRST: prove the obvious implementation is broken. One statement, two
    // rows trading ranks 4 and 3. Postgres checks the partial unique index per
    // row, so this raises 23505 on a sheet that is perfectly legal.
    const naive = await ctx
      .authedClient("member")
      .from("pickem_picks")
      .upsert(
        [
          { id: genId("p"), game_id: gameId, slate_game_id: slateIds[0], user_id: ctx.getUser("member").id, pick: "home", confidence: 3 },
          { id: genId("p"), game_id: gameId, slate_game_id: slateIds[1], user_id: ctx.getUser("member").id, pick: "home", confidence: 4 },
        ],
        { onConflict: "slate_game_id,user_id" }
      );
    expect(naive.error?.code).toBe("23505");

    // The sheet is untouched by that failure — no half-swap.
    expect((await readSheet()).map((r) => r!.confidence)).toEqual([4, 3, 2, 1]);

    // NOW the RPC, doing the same swap.
    const swapped = sheet({ 0: { confidence: 3 }, 1: { confidence: 4 } });
    expect((await save(swapped)).error).toBeNull();
    expect((await readSheet()).map((r) => r!.confidence)).toEqual([3, 4, 2, 1]);
  });

  it("a FULL REVERSAL saves — every rank moves at once", async () => {
    await save(sheet());
    const reversed = slateIds.map((id, i) => ({ slateGameId: id, pick: "away", confidence: i + 1 }));
    expect((await save(reversed)).error).toBeNull();
    expect((await readSheet()).map((r) => r!.confidence)).toEqual([1, 2, 3, 4]);
    expect((await readSheet()).map((r) => r!.pick)).toEqual(["away", "away", "away", "away"]);
  });

  // ── SECURITY INVOKER — the line most likely to be "made consistent" ──────

  it("IS SECURITY INVOKER — a definer here would BE the staff bypass the policies refuse", () => {
    // A SOURCE guard, and the reason it is one is worth stating: there is NO
    // reachable state that distinguishes the two modes behaviourally.
    // `pickem_picks_write` requires own-row AND open AND membership;
    // `pickem_picks_open` requires membership; the lifecycle check therefore
    // refuses everyone RLS would have refused, and a DEFINER version of this
    // function would pass every test in this file.
    //
    // Which is exactly why it needs a guard. The hazard is not a subtle bug — it
    // is one word being made "consistent" with the two SECURITY DEFINER
    // functions sitting beside it in the same migration, by someone who has read
    // migration 147's argument and drawn the opposite conclusion from it.
    const sql = readFileSync(
      join(__dirname, "../../../supabase/migrations/20260827180000_150_pickem_save_picks.sql"),
      "utf8"
    );
    const body = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.save_pickem_picks"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.save_pickem_picks")
    );
    // The premise: the slice found something, so "does not contain DEFINER" is
    // not being satisfied by an empty string.
    expect(body).toContain("LANGUAGE plpgsql");
    expect(body).toContain("SECURITY INVOKER");
    expect(body).not.toContain("SECURITY DEFINER");
  });

  it("the service role cannot use it either — auth.uid() is the only source of identity", async () => {
    // Not a test of INVOKER (a definer body would raise the same thing), but a
    // real property: nothing writes a sheet attributed to nobody.
    const asServiceRole = await ctx.admin.rpc("save_pickem_picks", {
      p_game_id: gameId,
      p_picks: sheet(),
    });
    expect(asServiceRole.error?.message).toContain("NOT_AUTHENTICATED");
    const { count } = await ctx.admin
      .from("pickem_picks")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(count).toBe(0);
  });

  it("writes the CALLER's sheet and cannot be pointed at anyone else's", async () => {
    // The payload carries no user_id at all — `auth.uid()` is the only source.
    // So two people calling it with identical payloads produce two sheets.
    await save(sheet({ 0: { pick: "away" } }), "member");
    await save(sheet({ 0: { pick: "home" } }), "owner");

    expect((await readSheet("member"))[0]!.pick).toBe("away");
    expect((await readSheet("owner"))[0]!.pick).toBe("home");
  });

  // ── the lifecycle gate ───────────────────────────────────────────────────

  it("refuses before picks open, and says so rather than writing nothing", async () => {
    await ctx.admin.from("pickem_games").update({ picks_opened_at: null }).eq("game_id", gameId);
    const { error } = await save(sheet());
    expect(error?.message).toContain("PICKS_CLOSED");
  });

  it("refuses once the deadline has passed — for the OWNER too", async () => {
    await ctx.admin
      .from("pickem_games")
      .update({ picks_deadline: new Date(Date.now() - 60_000).toISOString() })
      .eq("game_id", gameId);
    expect((await save(sheet(), "member")).error?.message).toContain("PICKS_CLOSED");
    // Spec §13's rule, through the new door: the person holding the button is
    // subject to it. Phase 0 pinned this on the POLICY; this pins it on the RPC,
    // which is a different code path and would fail differently.
    expect((await save(sheet(), "owner")).error?.message).toContain("PICKS_CLOSED");
  });

  it("refuses a hand-locked game", async () => {
    await ctx.admin
      .from("pickem_games")
      .update({ picks_locked_at: new Date().toISOString() })
      .eq("game_id", gameId);
    expect((await save(sheet())).error?.message).toContain("PICKS_CLOSED");
  });

  it("an outsider to the trip is refused", async () => {
    expect((await save(sheet(), "outsider")).error).not.toBeNull();
    const { count } = await ctx.admin
      .from("pickem_picks")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(count).toBe(0);
  });

  // ── the sheet must be a whole sheet ──────────────────────────────────────

  it("refuses a partial sheet — spec §4 has no such state", async () => {
    const { error } = await save(sheet().slice(0, 2));
    expect(error?.message).toContain("INCOMPLETE_SHEET");
  });

  it("refuses a DUPLICATED game that would otherwise pass a bare count", async () => {
    const dup = [...sheet().slice(0, 3), { slateGameId: slateIds[0], pick: "away", confidence: 1 }];
    expect(dup).toHaveLength(SLATE_SIZE);
    const { error } = await save(dup);
    expect(error?.message).toContain("INCOMPLETE_SHEET");
  });

  it("refuses a game that belongs to a different slate", async () => {
    const foreign = [...sheet().slice(0, 3), { slateGameId: genId("elsewhere"), pick: "home", confidence: 1 }];
    const { error } = await save(foreign);
    expect(error?.message).toContain("UNKNOWN_SLATE_GAME");
  });

  it.each([
    ["a repeated rank", [4, 4, 2, 1]],
    ["a hole", [4, 3, 1, 1]],
    ["a rank above N", [5, 3, 2, 1]],
    ["a null on a confidence game", [4, 3, 2, null]],
  ])("refuses %s", async (_label, ranks) => {
    const picks = slateIds.map((id, i) => ({ slateGameId: id, pick: "home", confidence: ranks[i] }));
    const { error } = await save(picks);
    expect(error?.message).toContain("BAD_CONFIDENCE");
  });

  // ── confidence off ───────────────────────────────────────────────────────

  it("confidence OFF stores NULL even when the client sends ranks", async () => {
    // Not "refuses" — corrects. The value is meaningless on this game, and
    // storing the 1s the client happened to send would collide on the second
    // row under the partial unique index.
    await ctx.admin.from("pickem_games").update({ use_confidence: false }).eq("game_id", gameId);
    const withRanks = slateIds.map((id) => ({ slateGameId: id, pick: "away", confidence: 1 }));
    expect((await save(withRanks)).error).toBeNull();
    expect((await readSheet()).map((r) => r!.confidence)).toEqual([null, null, null, null]);
    expect((await readSheet()).map((r) => r!.pick)).toEqual(["away", "away", "away", "away"]);
  });

  // ── submitted is not locked ──────────────────────────────────────────────

  it("SAVING DOES NOT LOCK — a second save overwrites the first", async () => {
    await save(sheet());
    expect((await save(sheet({ 2: { pick: "away" } }))).error).toBeNull();
    expect((await readSheet()).map((r) => r!.pick)).toEqual(["home", "home", "away", "home"]);
    // ...and it did not accumulate rows: one call per contest, still four.
    const { count } = await ctx.admin
      .from("pickem_picks")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(count).toBe(SLATE_SIZE);
  });

  // ── a SLATE CHANGE clears the ranking (migration 156) ───────────────────
  //
  // This block used to exercise `reopen`, which cleared every ranking as a
  // side effect of making the slate editable. Migration 156 deleted that action
  // and moved the clear to the slate save, where the cause is — so the same
  // coverage lives on against the new trigger rather than being dropped along
  // with the function it happened to hang off.

  /** Lock, write a slate, unlock. The slate is frozen only while picks are
   *  OPEN, so locking is the whole of "let me edit this" now — and on its own
   *  it destroys nothing. */
  const saveSlate = async (ids: string[]) => {
    await ctx
      .authedClient("owner")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "lock" });
    const res = await ctx.authedClient("owner").rpc("save_pickem_config", {
      p_game_id: gameId,
      p_payload: {
        slate: ids.map((id, i) => ({ id, awayTeam: `Away${i}`, homeTeam: `Home${i}` })),
      },
    });
    await ctx
      .authedClient("owner")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "unlock" });
    return res;
  };

  it("REMOVING a game keeps every surviving pick and clears every ranking", async () => {
    await save(sheet({ 0: { pick: "away" }, 3: { pick: "away" } }));

    const { error } = await saveSlate(slateIds.slice(1));
    expect(error).toBeNull();

    const { data } = await ctx.admin
      .from("pickem_picks")
      .select("slate_game_id, pick, confidence")
      .eq("game_id", gameId);
    // The removed game's pick went with it (FK cascade); the rest survive.
    expect(data).toHaveLength(SLATE_SIZE - 1);
    expect((data ?? []).every((r) => r.confidence === null)).toBe(true);
  });

  it("an UNCHANGED slate clears NOTHING — the whole point of moving the clear", async () => {
    // Under `reopen` this case destroyed every ranking for a runner who opened
    // the door and changed his mind. It is the regression that matters most
    // here, and it is the one the old design could not express.
    await save(sheet());
    const before = (await readSheet()).map((r) => r!.confidence);
    expect(before.every((c) => c !== null)).toBe(true);

    const { error } = await saveSlate(slateIds);
    expect(error).toBeNull();

    expect((await readSheet()).map((r) => r!.confidence)).toEqual(before);
  });

  it("clears EVERY participant's ranking, not just the caller's", async () => {
    // The runner is a participant too, and his own sheet is the one he can see.
    // Clearing only the caller's would look correct from the only screen he has.
    await save(sheet(), "member");
    await save(sheet(), "owner");

    await saveSlate(slateIds.slice(1));

    const { data } = await ctx.admin
      .from("pickem_picks")
      .select("user_id, confidence")
      .eq("game_id", gameId);
    expect(new Set((data ?? []).map((r) => r.user_id)).size).toBe(2);
    expect((data ?? []).every((r) => r.confidence === null)).toBe(true);
  });

  // ── set_deadline: one column, any phase (migration 153) ─────────────────

  const setDeadline = (iso: string | null, role: "owner" | "member" = "owner") =>
    ctx.authedClient(role).rpc("set_pickem_deadline", { p_game_id: gameId, p_deadline: iso });

  it("SETTING A DEADLINE DOES NOT PUBLISH A BUILDING GAME", () => {
    // The reason this function exists. `set_pickem_phase('open')` was the only
    // way to write a deadline, and it also coalesces picks_opened_at — so
    // scheduling one while still building would have handed sixteen people a
    // slate the runner was not finished with.
    return (async () => {
      await ctx.admin.from("pickem_games").update({ picks_opened_at: null }).eq("game_id", gameId);
      const when = new Date(Date.now() + 3_600_000).toISOString();
      expect((await setDeadline(when)).error).toBeNull();

      const { data } = await ctx.admin
        .from("pickem_games").select("picks_opened_at, picks_deadline").eq("game_id", gameId).single();
      expect(data!.picks_opened_at).toBeNull();            // still building
      expect(new Date(data!.picks_deadline as string).getTime()).toBe(new Date(when).getTime());
    })();
  });

  it("SETTING A DEADLINE DOES NOT UNLOCK A LOCKED GAME", async () => {
    // The other half. `open` clears picks_locked_at, so editing a deadline on a
    // locked game would have reopened every sheet and un-revealed the matches.
    await ctx.authedClient("owner")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "lock" });
    const before = await ctx.admin
      .from("pickem_games").select("picks_locked_at").eq("game_id", gameId).single();
    expect(before.data!.picks_locked_at).not.toBeNull();

    expect((await setDeadline(new Date(Date.now() + 7_200_000).toISOString())).error).toBeNull();

    const after = await ctx.admin
      .from("pickem_games").select("picks_locked_at").eq("game_id", gameId).single();
    // Same stamp, not merely non-null — a re-lock would also be non-null.
    expect(after.data!.picks_locked_at).toBe(before.data!.picks_locked_at);
  });

  it("clears the deadline when given null", async () => {
    await setDeadline(new Date(Date.now() + 3_600_000).toISOString());
    expect((await setDeadline(null)).error).toBeNull();
    const { data } = await ctx.admin
      .from("pickem_games").select("picks_deadline").eq("game_id", gameId).single();
    expect(data!.picks_deadline).toBeNull();
  });

  it("ACCEPTS a past deadline — that is how a runner records when picks closed", async () => {
    // Not a missing guard. The lazy predicate reads a past deadline as closed,
    // which is a legitimate way to end picks; refusing it would forbid typing
    // the time they actually closed.
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await setDeadline(past)).error).toBeNull();
    expect((await save(sheet())).error?.message).toContain("PICKS_CLOSED");
  });

  it("a plain member cannot set the deadline", async () => {
    expect((await setDeadline(new Date().toISOString(), "member")).error?.message)
      .toContain("NOT_AUTHORIZED");
  });

  // ── unlock: the narrow inverse of lock (migration 151) ──────────────────

  it("UNLOCK reopens picks WITHOUT touching the slate or anyone's ranking", async () => {
    // The gap it fills: before 151, undoing a lock meant `reopen`, which clears
    // every ranking. So "I locked a minute early" and "I need to change the
    // games" shared one answer, and it was the destructive one.
    await save(sheet({ 0: { pick: "away" } }));
    await ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "lock" });

    const locked = await ctx.admin
      .from("pickem_games").select("picks_locked_at").eq("game_id", gameId).single();
    expect(locked.data!.picks_locked_at).not.toBeNull();

    const { error } = await ctx.authedClient("owner")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "unlock" });
    expect(error).toBeNull();

    const after = await ctx.admin
      .from("pickem_games").select("picks_opened_at, picks_locked_at").eq("game_id", gameId).single();
    expect(after.data!.picks_locked_at).toBeNull();
    // Still OPEN — unlock is not reopen, so the game did not fall back to building.
    expect(after.data!.picks_opened_at).not.toBeNull();

    // ...and the sheet survived intact, rankings included. This is the whole
    // difference from reopen, which nulls every confidence.
    const rows = await readSheet();
    expect(rows.map((r) => r!.pick)).toEqual(["away", "home", "home", "home"]);
    expect(rows.map((r) => r!.confidence)).toEqual([4, 3, 2, 1]);
  });

  it("unlock makes the sheet WRITABLE again — the point of it", async () => {
    // Asserting the state columns alone would pass against an unlock that
    // cleared the stamp but left the policy refusing writes. The write is what
    // the runner is actually restoring.
    await save(sheet());
    await ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "lock" });
    expect((await save(sheet({ 1: { pick: "away" } }))).error?.message).toContain("PICKS_CLOSED");

    await ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "unlock" });
    expect((await save(sheet({ 1: { pick: "away" } }))).error).toBeNull();
    expect((await readSheet())[1]!.pick).toBe("away");
  });

  it("unlocking past a DEADLINE is a no-op, because the deadline still binds", async () => {
    // The subtle arm. `picks_open` is opened AND not-hand-locked AND within the
    // deadline, so clearing the hand lock cannot outrank a promise already made
    // to sixteen people. Extending the deadline is `open`'s job, not unlock's.
    await ctx.admin
      .from("pickem_games")
      .update({ picks_deadline: new Date(Date.now() - 60_000).toISOString() })
      .eq("game_id", gameId);

    await ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "unlock" });
    expect((await save(sheet())).error?.message).toContain("PICKS_CLOSED");
  });

  it("unlock on a game that never OPENED does nothing", async () => {
    await ctx.admin.from("pickem_games").update({ picks_opened_at: null }).eq("game_id", gameId);
    const { error } = await ctx.authedClient("owner")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "unlock" });
    expect(error).toBeNull();
    const after = await ctx.admin
      .from("pickem_games").select("picks_opened_at").eq("game_id", gameId).single();
    expect(after.data!.picks_opened_at).toBeNull();
  });

  it("a plain member cannot unlock", async () => {
    const { error } = await ctx.authedClient("member")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "unlock" });
    expect(error?.message).toContain("NOT_AUTHORIZED");
  });

  it("REOPEN no longer exists — it is refused, not silently accepted", async () => {
    // The guard on migration 156. `reopen` nulled every ranking as a side
    // effect of making the slate editable, irreversibly and with no audit
    // table anywhere in this schema. A build that restores the action fails
    // here rather than quietly restoring the destruction with it.
    const { error } = await ctx
      .authedClient("owner")
      .rpc("set_pickem_phase", { p_game_id: gameId, p_action: "reopen" });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("BAD_ACTION");
  });
});
