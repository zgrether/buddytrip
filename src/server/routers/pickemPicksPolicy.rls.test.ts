import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Pick'em Phase 0 — the picks policy has no staff branch, and these tests are
 * what says so.
 *
 * ── Why this file drives PostgREST and not tRPC ─────────────────────────────
 *
 * The 2026-08-20 RLS audit's central finding: **a test that goes through the
 * callers cannot see a policy wider than its callers.** Twelve gaps sat behind
 * correct, careful procedures; the app never did the thing the policy permitted,
 * so no caller-level test could fail and none did. Every read below therefore
 * goes through `authedClient` — the anon key plus a real Bearer token, which is
 * exactly what a participant's browser holds and exactly what someone curious
 * about their opponent's sheet would use.
 *
 * There will eventually be a tRPC procedure that reads picks. It will be
 * well-behaved. That is not the question this file asks.
 *
 * ── The assertion that has to be here, or the suite is decorative ───────────
 *
 * The spec names four suites that pass against a plausible WRONG build, and
 * assigns this one to Phase 0: *"a suite that never checks cross-participant
 * reads passes against a policy with a staff bypass."* So the load-bearing
 * cases are not "a member sees their own picks" — they are **the Owner, the
 * Organizer and the game delegate each reading somebody else's sheet and
 * getting nothing.** Those three are the ones that fail the moment anyone adds
 * `OR has_trip_role(...)` to `pickem_picks_select` for consistency with the
 * score policies, which is the realistic way this regresses.
 *
 * Confirmed non-vacuous the way CLAUDE.md requires, by actually doing it rather
 * than by asserting it: `pickem_picks_select` was replaced in the live local
 * database with a copy carrying `OR has_trip_role(...) OR is_game_delegate(...)`
 * — the exact widening this guards against — and the suite went from 31 passed
 * to **6 failed / 25 passed**: every cross-participant read, including all
 * three staff cases (Owner, Organizer, delegate). The policy was then restored
 * by re-applying the migration file and the suite returned to 31.
 *
 * The slate gate was checked the same way. Dropping `picks_opened_at` from
 * `pickem_slate_games_select` — leaving a plain `is_trip_member` read, which is
 * what "for consistency" would produce — fails exactly one case: *before picks
 * open, a plain member cannot COUNT the slate*. One test, and it is the only
 * thing standing between a member and knowing whether the runner has built the
 * slate yet.
 *
 * (The first attempt at that check proved nothing and looked like it had:
 * `docker exec` without `-i` never read the heredoc, so the "widened" run was
 * the unmodified policy passing. Worth recording, because a verification step
 * that silently does not run is the failure mode CLAUDE.md's "a message that
 * states a finding must be produced by the thing that found it" describes, and
 * it appeared here inside the check written to prevent it.)
 *
 * ── Refusals have two different shapes and are asserted differently ─────────
 *
 * This is the subtle part, and getting it wrong produces tests that pass
 * against a broken policy:
 *
 *   * INSERT against a failing WITH CHECK **errors** (42501).
 *   * UPDATE/DELETE against a failing USING **matches zero rows and returns no
 *     error at all.** Asserting `error` is non-null there would be asserting
 *     something the mechanism never produces — so every write-refusal case
 *     below reads the row back through the ADMIN client and asserts it is
 *     unchanged, which is the only thing that distinguishes "refused" from
 *     "applied".
 *   * SELECT against a failing USING returns `[]` with no error.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** An unauthenticated client — the publishable key alone, which ships in the
 *  client bundle and is public by design. */
const anonClient = () => createClient(SUPABASE_URL, ANON_KEY);

let ctx: TestContext;
let tripId: string;
let gameId: string;
let slateA: string;
let slateB: string;
/** A second game, for the cross-game integrity check. */
let otherGameId: string;
let otherSlate: string;
/**
 * A THIRD game, whose only job is the delegate branch.
 *
 * It exists because `member` has to be a plain trip member on the main game.
 * The slate-visibility rule is "a member cannot count the slate before picks
 * open", and the only reader who can prove it is one whose zero is caused by
 * the clock rather than by anything else — an outsider reads zero because they
 * are not on the trip, and a delegate reads two. If `member` were a delegate
 * everywhere, this file would have no such reader and that test would pass
 * against a policy with the gate deleted.
 */
let delegateGameId: string;
let delegateSlate: string;

const HOUR = 3_600_000;

describe("pick'em picks — the owner-of-the-row-only policy (migration 146)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    // Sequential, never Promise.all — these race and flake (CLAUDE.md).
    tripId = await ctx.createTrip("Pick'em Policy Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");

    gameId = genId("pkgame");
    // `game_type_id` is deliberately null: the pick'em game type is a Phase 2
    // artefact and nothing in this migration keys on it. The policy reads the
    // game's TRIP and its pick'em clock, never its format.
    await ctx.admin.from("games").insert({ id: gameId, trip_id: tripId, name: "Pick'em" });
    await ctx.admin.from("pickem_games").insert({ game_id: gameId });

    slateA = genId("slate");
    slateB = genId("slate");
    await ctx.admin.from("pickem_slate_games").insert({
      id: slateA, game_id: gameId, display_order: 0,
      away_team: "Alabama", home_team: "Georgia", spread: "-3.5", kickoff: "Thu 7:30p",
    });
    await ctx.admin.from("pickem_slate_games").insert({
      id: slateB, game_id: gameId, display_order: 1,
      away_team: "Ohio St", home_team: "Michigan",
    });

    // A sheet each. Same confidence values across people on purpose — ranks are
    // unique WITHIN a sheet, never across the field.
    for (const role of ["owner", "planner", "member"] as const) {
      await ctx.admin.from("pickem_picks").insert({
        id: genId(`pick-${role}-a`), game_id: gameId, slate_game_id: slateA,
        user_id: ctx.getUser(role).id, pick: "away", confidence: 2,
      });
      await ctx.admin.from("pickem_picks").insert({
        id: genId(`pick-${role}-b`), game_id: gameId, slate_game_id: slateB,
        user_id: ctx.getUser(role).id, pick: "home", confidence: 1,
      });
    }

    otherGameId = genId("pkgame2");
    await ctx.admin.from("games").insert({ id: otherGameId, trip_id: tripId, name: "Other Pick'em" });
    await ctx.admin.from("pickem_games").insert({ game_id: otherGameId });
    otherSlate = genId("slate2");
    await ctx.admin.from("pickem_slate_games").insert({
      id: otherSlate, game_id: otherGameId, display_order: 0,
      away_team: "Chiefs", home_team: "Bills",
    });

    // The delegate game. `member` runs it; `owner` plays in it. This is the
    // realistic shape — the runner hands a game to someone who is also picking
    // in it — and it is the only place `is_game_delegate` is exercised.
    delegateGameId = genId("pkgame3");
    await ctx.admin.from("games").insert({ id: delegateGameId, trip_id: tripId, name: "Delegated Pick'em" });
    await ctx.admin.from("pickem_games").insert({
      game_id: delegateGameId, picks_opened_at: new Date(Date.now() - HOUR).toISOString(),
    });
    delegateSlate = genId("slate3");
    await ctx.admin.from("pickem_slate_games").insert({
      id: delegateSlate, game_id: delegateGameId, display_order: 0,
      away_team: "Lions", home_team: "Packers",
    });
    await ctx.admin.from("game_delegates").insert({
      game_id: delegateGameId, user_id: ctx.getUser("member").id, granted_by: ctx.getUser("owner").id,
    });
    await ctx.admin.from("pickem_picks").insert({
      id: genId("pick-owner-del"), game_id: delegateGameId, slate_game_id: delegateSlate,
      user_id: ctx.getUser("owner").id, pick: "away", confidence: 1,
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  // ── clock helpers ────────────────────────────────────────────────────────
  //
  // The three lifecycle timestamps are the only inputs to both predicates, so
  // every state below is expressed by setting them and nothing else.

  /**
   * Set the lifecycle clock, and PROVE it was set.
   *
   * The read-back is not defensive noise. Every case below is a claim about
   * what happens in a particular state, so a clock write that silently did not
   * land turns the case into a claim about some other state — asserted just as
   * confidently. This suite's one non-reproducing failure was exactly that
   * shape: an insert that should have been refused succeeded, with the only
   * possible explanation being a clock that was not what the test believed.
   * Under a loaded local stack a PostgREST call can 502, and `.update()`
   * reports that in a returned `error` nobody was reading.
   */
  const setClock = async (
    patch: { picks_opened_at?: string | null; picks_deadline?: string | null; picks_locked_at?: string | null },
    id = gameId
  ) => {
    const next = { picks_opened_at: null, picks_deadline: null, picks_locked_at: null, ...patch };
    const { error } = await ctx.admin.from("pickem_games").update(next).eq("game_id", id);
    expect(error).toBeNull();

    const { data: applied, error: readErr } = await ctx.admin
      .from("pickem_games")
      .select("picks_opened_at, picks_deadline, picks_locked_at")
      .eq("game_id", id)
      .maybeSingle();
    expect(readErr).toBeNull();
    // Compared as instants, not strings — Postgres returns its own timestamptz
    // rendering, which is not character-identical to the ISO string sent.
    const asTime = (v: string | null | undefined) => (v == null ? null : new Date(v).getTime());
    expect(applied, `pickem_games row missing for ${id}`).not.toBeNull();
    expect({
      opened: asTime(applied!.picks_opened_at as string | null),
      deadline: asTime(applied!.picks_deadline as string | null),
      locked: asTime(applied!.picks_locked_at as string | null),
    }).toEqual({
      opened: asTime(next.picks_opened_at),
      deadline: asTime(next.picks_deadline),
      locked: asTime(next.picks_locked_at),
    });
  };

  /** State 1 — building. Never opened. */
  const stateBuilding = () => setClock({});
  /** State 2 — picks open, no deadline set. */
  const statePicksOpen = () =>
    setClock({ picks_opened_at: new Date(Date.now() - HOUR).toISOString() });
  /** State 2 with a deadline still in the future. */
  const statePicksOpenWithDeadline = () =>
    setClock({
      picks_opened_at: new Date(Date.now() - HOUR).toISOString(),
      picks_deadline: new Date(Date.now() + HOUR).toISOString(),
    });
  /** State 3 by the lazy path — the deadline simply passed. Nothing fired. */
  const stateDeadlinePassed = () =>
    setClock({
      picks_opened_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      picks_deadline: new Date(Date.now() - HOUR).toISOString(),
    });
  /** State 3 by the explicit path — the runner pressed Lock picks now. */
  const stateHandLocked = () =>
    setClock({
      picks_opened_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      picks_locked_at: new Date(Date.now() - HOUR).toISOString(),
    });

  const picksSeenBy = async (role: "owner" | "planner" | "member" | "outsider") => {
    const { data, error } = await ctx
      .authedClient(role)
      .from("pickem_picks")
      .select("id, user_id")
      .eq("game_id", gameId);
    expect(error).toBeNull();
    return data ?? [];
  };

  /** The set of DISTINCT people whose picks `role` can currently read. */
  const peopleVisibleTo = async (role: "owner" | "planner" | "member" | "outsider") =>
    new Set((await picksSeenBy(role)).map((r) => r.user_id as string));

  // ══ Before the lock — the hard rule ══════════════════════════════════════

  describe("state 2 (picks open) — a PARTICIPANT reads no sheet but their own", () => {
    beforeEach(async () => {
      await statePicksOpen();
    });

    it("a PLAIN PARTICIPANT sees their own sheet and nothing else", async () => {
      /**
       * THE load-bearing case in this file, and the one migration 163 did not
       * move. Proxy entry widened the read to the tiers that can WRITE a sheet
       * — staff, and a captain over their own team. A plain participant is
       * neither, so their refusal is untouched, and it is now the only thing
       * this describe block guards.
       *
       * Asserted as an exact SET rather than "my rows are present", because a
       * policy widened too far ALSO returns your own rows. Only the absence of
       * everyone else's distinguishes the two.
       *
       * `member` alone, deliberately. The previous version looped over owner,
       * planner and member together, so three refusals rode on one assertion —
       * and when 163 legitimately inverted two of them, the failure named a
       * case that was half correct. A guard that mixes an invariant with
       * something intended to change cannot report either one cleanly.
       */
      expect(await peopleVisibleTo("member")).toEqual(new Set([ctx.getUser("member").id]));
    });

    it("the OWNER reads any sheet — deliberately, as of 163", async () => {
      /**
       * REVERSES what this file asserted through Phase 0, and the reversal is a
       * decision rather than a regression.
       *
       * Phase 0's argument: the Owner holds the lock button, so reading the
       * room lets him tailor his own sheet before pressing it. The counter that
       * won: he also sets the slate, the spreads, the multipliers and the
       * results, so confidentiality FROM him was theater — and its price was
       * that nobody could enter a sheet for the placeholders, who cannot enter
       * their own by construction (no auth.uid(), so `pickem_picks_write` can
       * never match them).
       *
       * Write-without-read was considered and does not work: a proxy who can
       * overwrite Ty's sheet but not see it destroys twelve correct picks
       * blindfolded. Read follows write.
       */
      const visible = await peopleVisibleTo("owner");
      expect(visible.has(ctx.getUser("member").id)).toBe(true);
      expect(visible.has(ctx.getUser("planner").id)).toBe(true);
    });

    it("an ORGANIZER reads any sheet", async () => {
      const visible = await peopleVisibleTo("planner");
      expect(visible.has(ctx.getUser("owner").id)).toBe(true);
      expect(visible.has(ctx.getUser("member").id)).toBe(true);
    });

    it("a GAME DELEGATE cannot read the owner's picks", async () => {
      // The third branch the score policies carry, and the least obvious.
      // Runs on `delegateGameId`, where `member` holds the grant.
      //
      // POSITIVE CONTROL FIRST. If the `game_delegates` insert had silently
      // failed, the blindness assertion below would pass for the wrong reason —
      // "this person is not a delegate" rather than "delegates are blind here".
      // The slate policy's staff branch is the cheapest live proof that the
      // grant exists, because a plain member cannot read a slate before picks
      // open and this one is open... so instead assert it where only a delegate
      // can act: writing to the slate, which `pickem_slate_games_write` allows
      // for staff alone.
      const probeId = genId("delegate-probe");
      const { error: grantProof } = await ctx
        .authedClient("member")
        .from("pickem_slate_games")
        .insert({
          id: probeId, game_id: delegateGameId, display_order: 99,
          away_team: "Probe", home_team: "Control",
        });
      expect(grantProof).toBeNull(); // ← they really are a delegate of this game
      await ctx.admin.from("pickem_slate_games").delete().eq("id", probeId);

      // ...and BECAUSE they are a delegate they now read the owner's sheet on
      // THAT game, while staying blind on `gameId`, where they hold no grant.
      // The pair is the assertion: the delegate arm is scoped to the game the
      // grant names, not to the trip. Asserting only the first half would pass
      // against an arm that ignored `game_id` entirely.
      const { data, error } = await ctx
        .authedClient("member")
        .from("pickem_picks")
        .select("id, user_id")
        .eq("game_id", delegateGameId);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.user_id)).toEqual([ctx.getUser("owner").id]);

      expect(await peopleVisibleTo("member")).toEqual(new Set([ctx.getUser("member").id]));
    });

    it("a PARTICIPANT's targeted read returns nothing, not a filtered view", async () => {
      // The unfiltered read above could in principle be satisfied by a policy
      // that leaks only under a WHERE clause. Ask the leaking question directly.
      //
      // Re-aimed from `owner` to `member` by 163: the Owner is now entitled to
      // this row, so asking him proves nothing. The participant is the reader
      // whose refusal still has to hold, which makes this a STRONGER case than
      // it was rather than a weakened one.
      const { data, error } = await ctx
        .authedClient("member")
        .from("pickem_picks")
        .select("id, pick, confidence")
        .eq("game_id", gameId)
        .eq("user_id", ctx.getUser("owner").id);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("a PARTICIPANT's COUNT of another sheet is zero — the number is itself information", async () => {
      // `head: true` returns a count and no rows. A policy that hid the rows
      // but not their number would still tell a participant who had submitted
      // and how far along they were.
      //
      // What this does NOT contradict: `pickem_sheet_status` exposes exactly
      // this fact deliberately — to the people who can proxy, and to nobody
      // else. A participant can proxy for no one, so their count stays zero.
      const { count, error } = await ctx
        .authedClient("member")
        .from("pickem_picks")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId)
        .neq("user_id", ctx.getUser("member").id);
      expect(error).toBeNull();
      expect(count).toBe(0);
    });

    it("an outsider to the trip reads nothing at all", async () => {
      expect(await peopleVisibleTo("outsider")).toEqual(new Set());
    });

    it("an unauthenticated caller with the publishable key reads nothing", async () => {
      const { data } = await anonClient()
        .from("pickem_picks")
        .select("id")
        .eq("game_id", gameId);
      expect(data ?? []).toEqual([]);
    });
  });

  // ══ After the lock — the board has to work ═══════════════════════════════

  describe("state 3 — the reveal", () => {
    it("a hand lock reveals every sheet to trip members", async () => {
      await stateHandLocked();
      const visible = await peopleVisibleTo("member");
      expect(visible).toEqual(
        new Set([ctx.getUser("owner").id, ctx.getUser("planner").id, ctx.getUser("member").id])
      );
    });

    it("a PASSED DEADLINE reveals them with nothing having fired", async () => {
      // The lazy lock (spec §7.1). No scheduler ran, no column was written at
      // the deadline — the predicate simply reads now() and the answer changes.
      // This is the case that would fail if the reveal keyed on
      // `picks_locked_at` alone, which is the obvious wrong implementation.
      await stateDeadlinePassed();
      const visible = await peopleVisibleTo("member");
      expect(visible.size).toBe(3);
    });

    it("a FUTURE deadline does not reveal anything", async () => {
      await statePicksOpenWithDeadline();
      expect(await peopleVisibleTo("member")).toEqual(new Set([ctx.getUser("member").id]));
    });

    it("an outsider still reads nothing after the reveal", async () => {
      // Revealed means "to the trip", never "to the world".
      await stateHandLocked();
      expect(await peopleVisibleTo("outsider")).toEqual(new Set());
    });

    it("a past deadline on a game that never OPENED reveals nothing", async () => {
      // The two predicates are not inverses and this is where that matters: a
      // runner who sets a deadline while still building state 1 has not
      // published anything, and `revealed` must stay false.
      await setClock({ picks_deadline: new Date(Date.now() - HOUR).toISOString() });
      expect(await peopleVisibleTo("member")).toEqual(new Set([ctx.getUser("member").id]));
      // ...and their OWN sheet is still readable, which is the branch that
      // keeps this from being a vacuous "nothing is visible" assertion.
      expect((await picksSeenBy("member")).length).toBe(2);
    });
  });

  // ══ Writes ══════════════════════════════════════════════════════════════

  describe("writing a pick", () => {
    const readBack = async (id: string) => {
      const { data } = await ctx.admin
        .from("pickem_picks").select("pick, confidence").eq("id", id).maybeSingle();
      return data;
    };

    it("a participant can write their own pick while picks are open", async () => {
      await statePicksOpen();
      const id = genId("own-write");
      const { error } = await ctx.authedClient("member").from("pickem_picks").insert({
        id, game_id: gameId, slate_game_id: slateA, user_id: ctx.getUser("member").id,
        pick: "home", confidence: 9,
      });
      // Insert collides with the member's existing slateA pick (one call per
      // person per contest), so the real test is the UPDATE path.
      expect(error?.code).toBe("23505");

      const { data: mine } = await ctx.admin
        .from("pickem_picks").select("id")
        .eq("game_id", gameId).eq("user_id", ctx.getUser("member").id).eq("slate_game_id", slateA)
        .single();
      await ctx.authedClient("member").from("pickem_picks")
        .update({ pick: "home", confidence: 9 }).eq("id", mine!.id as string);
      expect(await readBack(mine!.id as string)).toEqual({ pick: "home", confidence: 9 });

      await ctx.admin.from("pickem_picks")
        .update({ pick: "away", confidence: 2 }).eq("id", mine!.id as string);
    });

    it("a participant CANNOT write a pick attributed to someone else", async () => {
      await statePicksOpen();
      const { error } = await ctx.authedClient("member").from("pickem_picks").insert({
        id: genId("forged"), game_id: gameId, slate_game_id: slateA,
        user_id: ctx.getUser("owner").id, pick: "home", confidence: 16,
      });
      // WITH CHECK refuses an INSERT loudly — this shape DOES error.
      expect(error?.code).toBe("42501");
    });

    it("the OWNER cannot edit a member's pick, even while picks are open", async () => {
      await statePicksOpen();
      const { data: theirs } = await ctx.admin
        .from("pickem_picks").select("id, pick, confidence")
        .eq("game_id", gameId).eq("user_id", ctx.getUser("member").id).eq("slate_game_id", slateB)
        .single();

      await ctx.authedClient("owner").from("pickem_picks")
        .update({ pick: "away", confidence: 16 }).eq("id", theirs!.id as string);

      // No error is produced — USING simply matched nothing. The row itself is
      // the only witness.
      expect(await readBack(theirs!.id as string))
        .toEqual({ pick: theirs!.pick, confidence: theirs!.confidence });
    });

    it("the OWNER cannot delete a member's pick", async () => {
      await statePicksOpen();
      const { data: theirs } = await ctx.admin
        .from("pickem_picks").select("id")
        .eq("game_id", gameId).eq("user_id", ctx.getUser("member").id).eq("slate_game_id", slateB)
        .single();
      await ctx.authedClient("owner").from("pickem_picks").delete().eq("id", theirs!.id as string);
      expect(await readBack(theirs!.id as string)).not.toBeNull();
    });

    it("THE OWNER'S OWN SHEET LOCKS AT THE DEADLINE, like everyone else's", async () => {
      // Spec §13. A separate claim from the read rule and it fails differently:
      // a write policy that carried the staff branch the read policy correctly
      // omits would let the person who pressed Lock keep editing afterwards.
      await stateHandLocked();
      const { data: mine } = await ctx.admin
        .from("pickem_picks").select("id, pick, confidence")
        .eq("game_id", gameId).eq("user_id", ctx.getUser("owner").id).eq("slate_game_id", slateA)
        .single();

      await ctx.authedClient("owner").from("pickem_picks")
        .update({ pick: "home", confidence: 15 }).eq("id", mine!.id as string);

      expect(await readBack(mine!.id as string))
        .toEqual({ pick: mine!.pick, confidence: mine!.confidence });
    });

    it("a member's own sheet locks once the deadline has simply passed", async () => {
      await stateDeadlinePassed();
      const { data: mine } = await ctx.admin
        .from("pickem_picks").select("id, pick, confidence")
        .eq("game_id", gameId).eq("user_id", ctx.getUser("member").id).eq("slate_game_id", slateA)
        .single();
      await ctx.authedClient("member").from("pickem_picks")
        .update({ confidence: 14 }).eq("id", mine!.id as string);
      expect(await readBack(mine!.id as string))
        .toEqual({ pick: mine!.pick, confidence: mine!.confidence });
    });

    it("nobody can write before picks open — not even the runner", async () => {
      await stateBuilding();
      const newId = genId("early");
      const { error } = await ctx.authedClient("owner").from("pickem_picks").insert({
        id: newId, game_id: gameId, slate_game_id: slateA,
        user_id: ctx.getUser("owner").id, pick: "away", confidence: 5,
      });
      expect(error?.code).toBe("42501");
      // Belt and braces: 42501 is the refusal, and no row is the consequence.
      const { count } = await ctx.admin
        .from("pickem_picks").select("*", { count: "exact", head: true }).eq("id", newId);
      expect(count).toBe(0);
    });
  });

  // ══ Confidence uniqueness — server-side, independent of the client ══════

  describe("confidence values", () => {
    it("a duplicate rank within one sheet is refused at the database", async () => {
      // Spec §13. The drag list makes duplicates unconstructible in the UI, but
      // this write never touches the UI — which is the entire reason the rule
      // has to exist twice.
      await statePicksOpen();
      const { error } = await ctx.authedClient("member").from("pickem_picks").insert({
        id: genId("dupe"), game_id: gameId, slate_game_id: slateB,
        user_id: ctx.getUser("member").id, pick: "away",
        confidence: 2, // already used by this member on slateA
      });
      expect(error?.code).toBe("23505");
    });

    it("two DIFFERENT participants may hold the same rank", async () => {
      // The inverse, so the constraint is not silently over-tight: ranks are
      // unique within a sheet, never across the field. All three seeded sheets
      // use 2 and 1, and all three exist.
      const { count } = await ctx.admin
        .from("pickem_picks")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId).eq("confidence", 2);
      expect(count).toBe(3);
    });

    it("a null confidence is allowed and does not collide (the confidence-off shape)", async () => {
      const a = genId("noconf-a");
      const b = genId("noconf-b");
      await ctx.admin.from("pickem_picks").insert({
        id: a, game_id: otherGameId, slate_game_id: otherSlate,
        user_id: ctx.getUser("owner").id, pick: "away", confidence: null,
      });
      const { error } = await ctx.admin.from("pickem_picks").insert({
        id: b, game_id: otherGameId, slate_game_id: otherSlate,
        user_id: ctx.getUser("member").id, pick: "home", confidence: null,
      });
      expect(error).toBeNull();
      await ctx.admin.from("pickem_picks").delete().in("id", [a, b]);
    });
  });

  // ══ The lifecycle predicates are directly callable — so they must ask ═══

  describe("pickem_picks_open / pickem_picks_revealed via direct rpc (migration 147)", () => {
    // Both are SECURITY DEFINER and both live in the exposed API schema, so
    // `authenticated` can POST to /rest/v1/rpc/... without going near a policy.
    // Before 147 neither established who was asking, and a signed-in non-member
    // got `true` from `pickem_picks_open` for a trip they had nothing to do with
    // — while the same account reading `pickem_games` directly got `[]`. A
    // definer helper wider than the policy it fronts is the RLS audit's
    // recurring shape, and this is the guard against it returning.

    it("a NON-MEMBER gets false from both, for a game whose picks really are open", async () => {
      await statePicksOpen();

      // Control first: the state is genuinely open, as a member sees it. Without
      // this the assertions below would pass against a game that was simply shut.
      const asMember = await ctx.authedClient("member").rpc("pickem_picks_open", { p_game_id: gameId });
      expect(asMember.error).toBeNull();
      expect(asMember.data).toBe(true);

      const open = await ctx.authedClient("outsider").rpc("pickem_picks_open", { p_game_id: gameId });
      expect(open.error).toBeNull();
      expect(open.data).toBe(false);

      await stateHandLocked();
      const revealedToMember = await ctx
        .authedClient("member").rpc("pickem_picks_revealed", { p_game_id: gameId });
      expect(revealedToMember.data).toBe(true);

      const revealed = await ctx
        .authedClient("outsider").rpc("pickem_picks_revealed", { p_game_id: gameId });
      expect(revealed.error).toBeNull();
      expect(revealed.data).toBe(false);
    });

    it("the same non-member cannot read the row the functions read", async () => {
      // The comparison that made this a finding rather than a hunch: the table
      // policy already refused this person. Only the function did not.
      const { data, error } = await ctx
        .authedClient("outsider").from("pickem_games").select("game_id").eq("game_id", gameId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("an unauthenticated caller cannot execute either function at all", async () => {
      // A different mechanism from the membership check — 146 revoked EXECUTE
      // from PUBLIC and anon, so this fails at the grant, not in the body.
      const { error } = await anonClient().rpc("pickem_picks_open", { p_game_id: gameId });
      expect(error).not.toBeNull();
    });
  });

  // ══ Referential integrity ═══════════════════════════════════════════════

  it("a pick cannot claim a slate game that belongs to a different game", async () => {
    // Asserted through the ADMIN client on purpose: this is a constraint, not a
    // policy, and it must hold for the service-role client too. Without it,
    // `pickem_picks.game_id` is an unchecked assertion and the caller chooses
    // which game's deadline applies to them.
    const { error } = await ctx.admin.from("pickem_picks").insert({
      id: genId("mismatch"), game_id: gameId, slate_game_id: otherSlate,
      user_id: ctx.getUser("owner").id, pick: "away", confidence: 7,
    });
    expect(error?.code).toBe("23503");
  });

  // ══ The slate is what enforces "members can't tell 1a from 1b" ══════════

  describe("slate visibility", () => {
    const slateRowsSeenBy = async (role: "owner" | "planner" | "member" | "outsider") => {
      const { data, error } = await ctx
        .authedClient(role).from("pickem_slate_games").select("id").eq("game_id", gameId);
      expect(error).toBeNull();
      return (data ?? []).length;
    };

    it("before picks open, a plain member cannot COUNT the slate", async () => {
      // Spec §3.1 rule 1 is enforced HERE, not in a component. "The runner has
      // added nothing" and "the runner has sixteen games and isn't ready"
      // differ by exactly a row count, and anyone holding a session can ask
      // PostgREST for that count directly.
      //
      // The reader must be `member`: a plain, non-delegate member of THIS trip.
      // An outsider would read zero whether or not the gate existed — their
      // zero is caused by `is_trip_member`, so it cannot witness the clock.
      await stateBuilding();
      const { count } = await ctx
        .authedClient("member")
        .from("pickem_slate_games")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId);
      expect(count).toBe(0);
      expect(await slateRowsSeenBy("member")).toBe(0);
    });

    it("before picks open, staff DO see the slate they are building", async () => {
      await stateBuilding();
      expect(await slateRowsSeenBy("owner")).toBe(2);
      expect(await slateRowsSeenBy("planner")).toBe(2);
    });

    it("once picks open, that SAME member sees the whole slate", async () => {
      // The pair matters more than either half: one reader, one query, two
      // clock states, two answers. That is what makes `picks_opened_at` the
      // demonstrated mechanism rather than an assumed one.
      await statePicksOpen();
      expect(await slateRowsSeenBy("member")).toBe(2);
    });

    it("the slate stays readable after the lock — the board needs it", async () => {
      // Keyed on opened-EVER, not on picks being open: the board renders one
      // row per slate game for the rest of the game's life.
      await stateHandLocked();
      expect(await slateRowsSeenBy("member")).toBe(2);
    });

    it("a plain member cannot add a game to the slate", async () => {
      // `member` again, not the outsider — a non-member's refusal proves only
      // that they are not on the trip. This asks whether MEMBERSHIP is enough
      // to edit the slate, which is the question the policy answers.
      await stateBuilding();
      const { error } = await ctx.authedClient("member").from("pickem_slate_games").insert({
        id: genId("intruder"), game_id: gameId, display_order: 99,
        away_team: "Nobody", home_team: "Nowhere",
      });
      expect(error?.code).toBe("42501");
    });
  });

  // ══ The guest merge must carry sheets across ════════════════════════════

  describe("merge_guest_to_real_user covers pick'em", () => {
    it("moves a placeholder's sheet onto the real account", async () => {
      const ghostId = `ghost-${genId()}`;
      await ctx.admin.from("users").insert({
        id: ghostId, name: "Placeholder", is_guest: true, created_by: ctx.getUser("owner").id,
      });
      await ctx.admin.from("pickem_picks").insert({
        id: genId("ghost-pick"), game_id: otherGameId, slate_game_id: otherSlate,
        user_id: ghostId, pick: "away", confidence: 4,
      });

      // `outsider` has no sheet in this game, so the guest's moves intact.
      const realId = ctx.getUser("outsider").id;
      const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
        p_ghost_id: ghostId, p_real_id: realId,
      });
      expect(error).toBeNull();

      const { data } = await ctx.admin
        .from("pickem_picks").select("user_id, confidence").eq("game_id", otherGameId);
      expect(data).toEqual([{ user_id: realId, confidence: 4 }]);
      await ctx.admin.from("pickem_picks").delete().eq("game_id", otherGameId);
    });

    it("drops the guest's sheet WHOLE when the real account already has one", async () => {
      // The reason this arm is per-GAME rather than per-row: `pickem_picks`
      // carries two unique keys, and a row-wise merge can satisfy
      // (slate_game_id, user_id) while breaking the confidence index — or
      // satisfy both and still produce a sheet with one rank twice and another
      // missing. Half of one person's opinions spliced into half of another's
      // is not a sheet anyone submitted.
      const ghostId = `ghost-${genId()}`;
      await ctx.admin.from("users").insert({
        id: ghostId, name: "Placeholder 2", is_guest: true, created_by: ctx.getUser("owner").id,
      });
      const realId = ctx.getUser("outsider").id;

      await ctx.admin.from("pickem_picks").insert({
        id: genId("real-pick"), game_id: otherGameId, slate_game_id: otherSlate,
        user_id: realId, pick: "home", confidence: 1,
      });
      await ctx.admin.from("pickem_picks").insert({
        id: genId("ghost-pick2"), game_id: otherGameId, slate_game_id: otherSlate,
        user_id: ghostId, pick: "away", confidence: 1,
      });

      const { error } = await ctx.admin.rpc("merge_guest_to_real_user", {
        p_ghost_id: ghostId, p_real_id: realId,
      });
      // Without the collision handling this raises 23505 INSIDE the signup
      // trigger, and signup fails for that person — the failure mode migration
      // 095 was written for.
      expect(error).toBeNull();

      const { data } = await ctx.admin
        .from("pickem_picks").select("user_id, pick").eq("game_id", otherGameId);
      expect(data).toEqual([{ user_id: realId, pick: "home" }]);
      await ctx.admin.from("pickem_picks").delete().eq("game_id", otherGameId);
    });
  });
});
