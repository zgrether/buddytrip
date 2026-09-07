import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * MIGRATION 184 — `skins_hole_outcomes`, its shape constraint, and who may write it.
 *
 * ── Why this runs at PostgREST level and not through tRPC ──────────────────
 *
 * Same reason as `scrambleGroupScoring.rls.test.ts` and
 * `rlsAuditFindings.rls.test.ts`: a test that goes through the callers cannot
 * see a policy wider than its callers. This migration introduces a policy from
 * nothing, so every case runs `authedClient` against a real JWT.
 *
 * ── What each block is for ─────────────────────────────────────────────────
 *
 * The SHAPE cases pin the empty-is-not-unknown encoding: a `tied` row and an
 * absent row are different facts, and the CHECK is what stops a third,
 * meaningless state ("won by nobody" / "tied, by this person") from existing at
 * all. That distinction is not decoration — the carryover fold branches on it.
 *
 * The ACCESS cases each move exactly one variable off a shared fixture, so a
 * policy that admitted everything could not pass them.
 *
 * Owner / Organizer / delegate are deliberately NOT exercised: they are admitted
 * by the policy's earlier OR-branches, so they would pass whatever
 * `can_score_skins_grouping` said and would prove nothing about it.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;
let myGroupId: string;
let otherGroupId: string;

describe("184 — skins hole outcomes", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    // Sequential, never Promise.all — these race and flake (CLAUDE.md).
    tripId = await ctx.createTrip("Skins RLS Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    // The `planner` HANDLE, at the `Member` ROLE deliberately: what this fixture
    // needs is a trip member with no elevated rights who is not in the game. An
    // Organizer would be admitted by the policy's earlier OR-branch and would
    // prove nothing about the member tier.
    await ctx.addTripMember(tripId, "planner", "Member");
    competitionId = await ctx.createCompetition(tripId, "Skins Cup");

    gameId = genId("game");
    await ctx.admin.from("games").insert({
      id: gameId,
      trip_id: tripId,
      competition_id: competitionId,
      game_type_id: "gtt_skins",
      name: "Skins",
      status: "active",
      scoring_enabled: true,
      pairings_published_at: new Date().toISOString(),
    });
    await ctx.admin.from("game_participants").insert({
      id: genId("gp"),
      game_id: gameId,
      user_id: ctx.getUser("member").id,
    });
    // The member's own grouping — `groupStrokeParticipants` creates the
    // play_group AND points their `game_participants.play_group_id` at it, which
    // is the link `can_score_skins_grouping` reads.
    myGroupId = await ctx.groupStrokeParticipants(gameId, [ctx.getUser("member").id]);
    // A SECOND grouping in the same game that the member is not in. It is the
    // competition boundary they are outside of, and the only variable case 2
    // moves.
    otherGroupId = genId("grp");
    await ctx.admin.from("play_groups").insert({
      id: otherGroupId, game_id: gameId, display_name: "Group 2", tee_time: null,
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.admin.from("skins_hole_outcomes").delete().eq("game_id", gameId);
    await ctx.admin.from("play_groups").delete().eq("id", otherGroupId);
    await ctx.cleanup();
  }, 60_000);

  // ── The shape constraint ─────────────────────────────────────────────────

  it("a WON hole must name a winner, and a TIED hole must not", async () => {
    /**
     * The two halves of `skins_hole_outcomes_result_shape`, asserted as a pair
     * because either alone is satisfied by a constraint that only does one job.
     *
     * The first is what keeps "tied" and "not entered" apart: if `won` admitted
     * a NULL winner, the table would carry a third state that reads as a tie,
     * renders as a blank, and computes as neither.
     */
    const wonWithoutWinner = await ctx.admin.from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 90, result: "won", winner_user_id: null,
      submitted_by: ctx.getUser("member").id,
    });
    const tiedWithWinner = await ctx.admin.from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 91, result: "tied", winner_user_id: ctx.getUser("member").id,
      submitted_by: ctx.getUser("member").id,
    });
    expect(wonWithoutWinner.error, "a won hole was stored with no winner").not.toBeNull();
    expect(tiedWithWinner.error, "a tied hole was stored with a winner").not.toBeNull();
  });

  it("one row per grouping per hole — a second row for the same hole is refused", async () => {
    // `UNIQUE (grouping_id, hole_number)` is what makes a re-entry an UPSERT
    // rather than a duplicate, the same key `match_hole_outcomes` uses. Without
    // it a corrected hole would pay twice.
    const first = await ctx.admin.from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 92, result: "tied", winner_user_id: null,
      submitted_by: ctx.getUser("member").id,
    });
    const second = await ctx.admin.from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 92, result: "won", winner_user_id: ctx.getUser("member").id,
      submitted_by: ctx.getUser("member").id,
    });
    expect(first.error).toBeNull();
    expect(second.error, "a second row landed on the same grouping+hole").not.toBeNull();
  });

  // ── Access ───────────────────────────────────────────────────────────────

  it("a member of the grouping RECORDS its hole", async () => {
    const { error } = await ctx.authedClient("member").from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 1, result: "won", winner_user_id: ctx.getUser("member").id,
      submitted_by: ctx.getUser("member").id,
    });
    expect(error).toBeNull();
  });

  it("but NOT another grouping's hole in the same game", async () => {
    // Membership of the TARGET grouping admits the write, not membership of the
    // game. The groupings are independent contests, so writing into one you are
    // not in is not a lesser version of scoring — it is scoring somebody else's.
    const { error } = await ctx.authedClient("member").from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: otherGroupId,
      hole_number: 1, result: "tied", winner_user_id: null,
      submitted_by: ctx.getUser("member").id,
    });
    expect(error).not.toBeNull();
  });

  it("a trip member who is not IN the game records nothing", async () => {
    // `planner` is a trip member — so the SELECT policy admits them — and is not
    // a participant. Read and write are different questions here and the fixture
    // asks the second one.
    const { error } = await ctx.authedClient("planner").from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 2, result: "tied", winner_user_id: null,
      submitted_by: ctx.getUser("planner").id,
    });
    expect(error).not.toBeNull();
  });

  it("THE MEMBER TIER DEPENDS ON scoring_enabled — flip it and the same write is refused", async () => {
    /**
     * The mutation check, run as a test.
     *
     * `can_score_skins_grouping` is only reached behind `g.scoring_enabled =
     * true`, and without that clause an ordinary member could record holes on a
     * game still in setup. Every other case in this file passes either way, so
     * this is the only one that separates the shipped policy from one that
     * dropped the flag.
     *
     * Done by moving ONE COLUMN on a game this file created rather than by
     * replacing the policy: the local stack is shared with other sessions, and
     * `skins_hole_outcomes_write` is only ours, but the habit of not reaching
     * outside the fixture is the point (see `scrambleGroupScoring.rls.test.ts`).
     */
    const insert = (hole: number) =>
      ctx.authedClient("member").from("skins_hole_outcomes").insert({
        id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
        hole_number: hole, result: "tied", winner_user_id: null,
        submitted_by: ctx.getUser("member").id,
      });

    await ctx.admin.from("games").update({ scoring_enabled: false }).eq("id", gameId);
    const refused = await insert(3);
    // Restore BEFORE asserting, so a failure cannot strand the fixture disabled
    // for whatever runs next.
    await ctx.admin.from("games").update({ scoring_enabled: true }).eq("id", gameId);
    const admitted = await insert(4);

    expect(refused.error, "a member recorded a hole on a game not open for scoring").not.toBeNull();
    expect(admitted.error, "the same write failed once scoring was re-enabled").toBeNull();
  });

  it("submitted_by cannot be forged", async () => {
    // The WITH CHECK asserts provenance rather than trusting it, mirroring
    // `score_entries_write`. Audit columns nobody enforces are the ones that end
    // up meaning nothing.
    const { error } = await ctx.authedClient("member").from("skins_hole_outcomes").insert({
      id: genId("sho"), game_id: gameId, grouping_id: myGroupId,
      hole_number: 5, result: "tied", winner_user_id: null,
      submitted_by: ctx.getUser("owner").id,
    });
    expect(error).not.toBeNull();
  });

  // ── Reset, and the guard that depends on it ──────────────────────────────

  it("reset_game_scoring clears them — the freeze in 185 names an action that works", async () => {
    /**
     * Not a nice-to-have. Migration 185 refuses a groupings change while these
     * rows exist and tells the reader to reset scores; if reset did not reach
     * this table that refusal would name an action the reader had already taken,
     * and the groupings would be frozen forever.
     *
     * The rows here are the ones the cases above left behind, so the assertion
     * is over a table that demonstrably had contents — a delete that clears
     * nothing would otherwise pass this.
     */
    const before = await ctx.admin
      .from("skins_hole_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(before.count ?? 0, "fixture left no rows, so the reset proves nothing").toBeGreaterThan(0);

    const { error } = await ctx.admin.rpc("_reset_game_scoring", { p_game_id: gameId });
    expect(error).toBeNull();

    const after = await ctx.admin
      .from("skins_hole_outcomes")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(after.count ?? 0).toBe(0);
  });
});
