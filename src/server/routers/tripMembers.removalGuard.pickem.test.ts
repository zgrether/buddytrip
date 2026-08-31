import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId, getAdminClient } from "../../__tests__/helpers/test-setup";
import { competitionHasScore } from "../lib/rosterLock";

/**
 * #1151 / #1018 — the two removal guards could not see a pick'em.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Both guards ask two questions: is this person IN a game, and has that game
 * begun producing results. A pick'em answered neither.
 *
 *   RESULTS  both counted `score_entries` (+ `match_hole_outcomes` in the
 *            removal guard). A pick'em writes ZERO rows in both, at every stage
 *            of its life — its outcomes live in `pickem_slate_games.result`.
 *   MEMBER   `game_participants` exists only for a PAIRED head-to-head player
 *            (`save_pickem_matches` reconciles it). Points mode has no matches
 *            at all, and an unpaired player's sheet outlives their pairing.
 *
 * ── Why every fixture here is a PICK'EM-ONLY trip ─────────────────────────
 *
 * Zero `score_entries`, zero `match_hole_outcomes`, and no golf game anywhere.
 * The sibling suite's `makeGameWith` helper writes a stroke game with a score,
 * which re-tests the path that already worked — that is precisely how this
 * defect survived two previous passes over these guards. Nothing in this file
 * may write a score.
 *
 * ── The wrong builds this file is pointed at ──────────────────────────────
 *
 * Case 2 (points mode) fails the `game_started`-only build — the tempting half
 * fix, which genuinely does repair case 1 and therefore looks complete.
 * Case 6 drives `competitionHasScore` directly, and fails a build that repairs
 * `participationGuard.ts` alone — the likelier half-ship, since only the other
 * call site produces the reported symptom.
 * Case 5 is the negative control: without it a guard that refuses EVERY removal
 * passes this entire file, and a false block is the regression an Organizer
 * meets on trip week while fixing a typo.
 */

const PICKEM = "gtt_pickem";

let ctx: TestContext;
let tripId: string;

/** Insert a fixture row, failing LOUDLY — a silently-absent blocking row makes
 *  a refusal test pass by absence, which this suite's sibling shipped once. */
async function seed(table: string, rows: Record<string, unknown> | Record<string, unknown>[]) {
  const { error } = await ctx.admin.from(table).insert(rows as never);
  if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
}

interface PickemOpts {
  name: string;
  /** Users who submit a sheet. */
  sheetFor: string[];
  /** Pair these two into a match via the real RPC (head-to-head shape). */
  pair?: [string, string];
  /** Record a result on the first slate game. */
  withResult: boolean;
  competitionId?: string;
}

/**
 * A pick'em game built the way the app builds one.
 *
 * The pairing goes through `save_pickem_matches` rather than a hand-written
 * `game_matches` insert, because that RPC is what reconciles `game_participants`
 * — the very fact case 1 turns on. A hand-rolled pairing would omit it and the
 * fixture would then measure a shape the app never produces (CLAUDE.md's
 * "a fixture that does not send what the real caller sends").
 */
async function makePickem(opts: PickemOpts): Promise<{ gameId: string; slateIds: string[] }> {
  const gameId = genId("pkgame");
  await seed("games", {
    id: gameId,
    trip_id: tripId,
    competition_id: opts.competitionId ?? null,
    game_type_id: PICKEM,
    name: opts.name,
  });
  await seed("pickem_games", {
    game_id: gameId,
    use_confidence: false,
    // Opened an hour ago and hand-locked: picks are closed and revealed, which
    // is the state a game is in once results start landing.
    picks_opened_at: new Date(Date.now() - 3_600_000).toISOString(),
    picks_locked_at: new Date(Date.now() - 60_000).toISOString(),
  });

  const slateIds = [genId("sl"), genId("sl")];
  await seed(
    "pickem_slate_games",
    slateIds.map((id, i) => ({
      id,
      game_id: gameId,
      display_order: i,
      away_team: `Away ${i}`,
      home_team: `Home ${i}`,
    }))
  );

  for (const uid of opts.sheetFor) {
    await seed(
      "pickem_picks",
      slateIds.map((sid) => ({
        id: genId("pk"),
        game_id: gameId,
        slate_game_id: sid,
        user_id: uid,
        pick: "home",
      }))
    );
  }

  if (opts.pair) {
    // As the OWNER, not as service-role: `save_pickem_matches` opens with
    // `assert_game_edit`, which reads `auth.uid()` — an admin client has none
    // and is refused NOT_AUTHORIZED. Calling it the way the runner does is also
    // the faithful fixture, which is the point of using the RPC at all.
    const { error } = await ctx.authedClient("owner").rpc("save_pickem_matches", {
      p_game_id: gameId,
      p_pairs: [{ a: opts.pair[0], b: opts.pair[1] }],
    });
    if (error) throw new Error(`save_pickem_matches failed: ${error.message}`);
  }

  if (opts.withResult) {
    const { error } = await ctx.admin
      .from("pickem_slate_games")
      .update({ result: "home" })
      .eq("id", slateIds[0]);
    if (error) throw new Error(`slate result failed: ${error.message}`);
  }

  return { gameId, slateIds };
}

async function dropPickem(gameId: string) {
  await ctx.admin.from("pickem_picks").delete().eq("game_id", gameId);
  await ctx.admin.from("game_results").delete().eq("game_id", gameId);
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", gameId);
  await ctx.admin.from("pickem_games").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
}

async function restore(userId: string) {
  await ctx.admin
    .from("trip_members")
    .insert({ trip_id: tripId, user_id: userId, role: "Member", status: "in" });
}

/**
 * The refusal, asserted at the MECHANISM.
 *
 * `blocked === true` alone would pass against a guard refusing for an unrelated
 * reason — an expense, a stray bracket row, or a guard that refuses everyone.
 * So this pins the blocker to THIS game by id and to the reason the pick'em
 * path is supposed to produce.
 */
async function expectBlockedBy(userId: string, gameId: string, gameName: string) {
  const info = (await ctx.caller().tripMembers.removalBlockers({ tripId, userId })) as {
    blocked: boolean;
    blockers: { games: { gameId: string; gameName: string; reasons: string[] }[] };
    message: string | null;
  };
  expect(info.blocked).toBe(true);
  const hit = info.blockers.games.find((g) => g.gameId === gameId);
  expect(hit, `no blocker named game ${gameId}; got ${JSON.stringify(info.blockers.games)}`)
    .toBeTruthy();
  expect(hit!.gameName).toBe(gameName);
  expect(hit!.reasons).toContain("played-game");
  expect(info.message).toContain(gameName);

  // The mutation is the authority — the courtesy query agreeing is not enough.
  await expect(
    ctx.caller().tripMembers.remove({ tripId, userId })
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

  const { data: tm } = await ctx.admin
    .from("trip_members").select("user_id")
    .eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  expect(tm, "a refusal must not half-apply").toMatchObject({ user_id: userId });
}

describe("#1151/#1018 — removal guards can see a pick'em", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Pick'em Removal Guard Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Member");
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("1 · REFUSES a PAIRED head-to-head player once a result is recorded", async () => {
    const target = ctx.getUser("member").id;
    const other = ctx.getUser("outsider").id;
    const { gameId } = await makePickem({
      name: "NFL Week 1",
      sheetFor: [target, other],
      pair: [target, other],
      withResult: true,
    });

    // The premise this case turns on, asserted rather than assumed: the pairing
    // RPC really did write the participant row. If it stops doing so, this case
    // silently becomes a duplicate of case 3 and would still pass.
    const { data: gp } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect((gp ?? []).map((r) => r.user_id).sort()).toEqual([target, other].sort());

    // And the golf tables really are empty — the whole point of the fixture.
    const { count: se } = await ctx.admin
      .from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", gameId);
    expect(se ?? 0).toBe(0);

    await expectBlockedBy(target, gameId, "NFL Week 1");
    await dropPickem(gameId);
  }, 60_000);

  it("2 · REFUSES in POINTS mode, where NOBODY has a participant row", async () => {
    /**
     * The case that fails a `game_started`-only build. A points-mode pick'em has
     * no matches, so `save_pickem_matches` never runs and `myGameIds` is empty
     * — swapping the results probe alone leaves the membership question
     * answering no, the probe loop unreached, and the removal permitted.
     */
    const target = ctx.getUser("member").id;
    const { gameId } = await makePickem({
      name: "Points Slate",
      sheetFor: [target],
      withResult: true,
    });

    const { data: gp } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect(gp ?? [], "fixture must have NO participant rows or it tests case 1").toHaveLength(0);
    const { data: gm } = await ctx.admin
      .from("game_matches").select("id").eq("game_id", gameId);
    expect(gm ?? []).toHaveLength(0);

    await expectBlockedBy(target, gameId, "Points Slate");
    await dropPickem(gameId);
  }, 60_000);

  it("3 · REFUSES an UNPAIRED sheet-holder in a head-to-head game", async () => {
    /**
     * The sheet deliberately survives unpairing (`save_pickem_matches`: "their
     * SHEET is untouched … a person left out of this round's matches may be
     * paired in the next save"). So the participant row is gone and the sheet
     * is the only thing left saying they are in this game — and it still scores.
     */
    const target = ctx.getUser("member").id;
    const other = ctx.getUser("outsider").id;
    const owner = ctx.user.id;
    const { gameId } = await makePickem({
      name: "Unpaired Slate",
      sheetFor: [target, other, owner],
      // The pairing leaves `target` out of the field entirely.
      pair: [other, owner],
      withResult: true,
    });

    const { data: gp } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect(
      (gp ?? []).map((r) => r.user_id),
      "the unpaired player must have NO participant row"
    ).not.toContain(target);
    const { data: pk } = await ctx.admin
      .from("pickem_picks").select("id").eq("game_id", gameId).eq("user_id", target);
    expect((pk ?? []).length, "but their sheet must survive").toBeGreaterThan(0);

    await expectBlockedBy(target, gameId, "Unpaired Slate");
    await dropPickem(gameId);
  }, 60_000);

  it("4 · REFUSES on a FINALIZED pick'em that has already paid the cup", async () => {
    /**
     * The stage revision 1 did not know was broken. Pick'em's finalize writes
     * `game_results` rows keyed `entity_type: 'team'` and never touches
     * `game_matches.result`, so the guard's `result` and `decided-match` arms
     * are dead here too — every one of its original signals is empty for a game
     * that is over and has been paid.
     */
    const target = ctx.getUser("member").id;
    const other = ctx.getUser("outsider").id;
    const competitionId = await ctx.createCompetition(tripId, "Pick'em Cup");
    // The cup needs TEAMS and a roster, or `pickemFinalize` has nobody to award
    // and writes no rows — "finalized" without "paid the cup", which is only
    // half the case this is here to make.
    const teamA = await ctx.createTeam(competitionId, "Reds");
    const teamB = await ctx.createTeam(competitionId, "Blues");
    await seed("team_assignments", [
      { competition_id: competitionId, user_id: target, team_id: teamA },
      { competition_id: competitionId, user_id: other, team_id: teamB },
    ]);
    const { gameId } = await makePickem({
      name: "Finalized Slate",
      sheetFor: [target, other],
      pair: [target, other],
      withResult: true,
      competitionId,
    });

    await ctx.caller().games.finish({ tripId, gameId });

    const { data: g } = await ctx.admin
      .from("games").select("status").eq("id", gameId).maybeSingle();
    expect(g?.status, "the fixture must actually be finalized").toBe("complete");

    // Named because it is WHY the old guard was blind, not decoration: not one
    // result row is keyed to a person, so `entity_id IN (sideIds)` finds none.
    const { data: gr } = await ctx.admin
      .from("game_results").select("entity_type, entity_id").eq("game_id", gameId);
    expect((gr ?? []).length).toBeGreaterThan(0);
    expect((gr ?? []).map((r) => r.entity_id)).not.toContain(target);

    await expectBlockedBy(target, gameId, "Finalized Slate");
    await dropPickem(gameId);
  }, 90_000);

  it("5 · CONTROL — a member with no sheet and no pairing is still REMOVABLE", async () => {
    /**
     * The negative control, and the failure this PR is most likely to introduce.
     * The pick'em is started and blocking somebody else; this person simply is
     * not in it. A guard that widened into "any started game on the trip blocks
     * anyone" passes every case above and fails only here.
     */
    const inIt = ctx.getUser("member").id;
    const bystander = ctx.getUser("outsider").id;
    const { gameId } = await makePickem({
      name: "Not Their Game",
      sheetFor: [inIt],
      withResult: true,
    });

    const info = (await ctx.caller().tripMembers.removalBlockers({
      tripId,
      userId: bystander,
    })) as { blocked: boolean; blockers: { games: unknown[] } };
    expect(info.blocked, "the bystander is in nothing").toBe(false);
    expect(info.blockers.games).toEqual([]);

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: bystander })
    ).resolves.toMatchObject({ success: true });

    const { data } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", bystander).maybeSingle();
    expect(data).toBeNull();

    // And the person who IS in it is still refused, from the same fixture —
    // so case 5 cannot pass by the guard having been switched off entirely.
    await expectBlockedBy(inIt, gameId, "Not Their Game");

    await dropPickem(gameId);
    await restore(bystander);
  }, 90_000);

  it("6 · a sheet in a game with NO result yet is a PLAN — removable", async () => {
    /**
     * The plan/result boundary for the new membership signal. Holding a sheet is
     * participation, but nothing has been decided, so removing them destroys no
     * result — the same rule `game_participants` has followed since #997.
     *
     * Without this, the membership arm could be a bare "has a sheet ⇒ refuse",
     * which would freeze a roster the moment picks opened.
     */
    const target = ctx.getUser("member").id;
    const { gameId } = await makePickem({
      name: "Slate With No Results",
      sheetFor: [target],
      withResult: false,
    });

    const info = (await ctx.caller().tripMembers.removalBlockers({
      tripId,
      userId: target,
    })) as { blocked: boolean };
    expect(info.blocked).toBe(false);

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).resolves.toMatchObject({ success: true });

    await dropPickem(gameId);
    await restore(target);
  }, 60_000);

  it("7 · competitionHasScore — the OTHER call site, driven directly", async () => {
    /**
     * `rosterLock.ts`, not `participationGuard.ts`. This is the half-ship guard:
     * one call site produces the reported symptom and this one does not, so a
     * PR that fixes only the first looks complete against every case above.
     *
     * It is competition-scoped and takes no user id, so it needs only the
     * results half — there is no membership question here to get wrong.
     */
    const competitionId = await ctx.createCompetition(tripId, "Roster Lock Cup");

    const before = await competitionHasScore(getAdminClient(), competitionId);
    expect(before, "a cup with no games has not started").toBe(false);

    const { gameId, slateIds } = await makePickem({
      name: "Lock Slate",
      sheetFor: [ctx.getUser("member").id],
      withResult: false,
      competitionId,
    });

    // Non-vacuity: the pick'em exists and is NOT started, so a `true` below
    // cannot come from the mere presence of a game.
    expect(
      await competitionHasScore(getAdminClient(), competitionId),
      "picks submitted but no result is not started"
    ).toBe(false);

    await ctx.admin.from("pickem_slate_games").update({ result: "away" }).eq("id", slateIds[1]);

    expect(
      await competitionHasScore(getAdminClient(), competitionId),
      "a recorded slate result starts the cup — this is the #1018 fix"
    ).toBe(true);

    await dropPickem(gameId);
  }, 90_000);
});
