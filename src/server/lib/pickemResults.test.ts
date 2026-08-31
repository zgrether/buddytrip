import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";

/**
 * The pick'em finalize, end to end — read, refuse, compute, write, award.
 *
 * The arithmetic lives in `src/lib/pickemFinalize.test.ts` and is not repeated
 * here. What this file exists for is the three things that only exist once a
 * database is involved, each of which fails SILENTLY:
 *
 *   1. the picks-open gate — a result recorded mid-picks silently stops
 *      matching the sheets it came from, because nothing recomputes it
 *   2. the two persisted shapes — a points cup stores POSITIONS so its payout
 *      stays derived; the other resolutions store the points themselves
 *   3. the leaderboard actually finding the rows — which it did not, before
 *      this change, for any pick'em game ever finalized
 *
 * The third is the one worth stating plainly: a pick'em game fell through every
 * branch of `computeCompetitionLeaderboard` and returned "contributes its pool,
 * awards nobody". So an assertion on `game_results` alone would have passed
 * against a build where the cup still paid zero. Every case below therefore ends
 * at `teamTotals`, not at the rows.
 */

let ctx: TestContext;
let tripId: string;
let owner: string;
let member: string;

/** One cup + one pick'em game inside it, torn down per suite. */
interface Fixture {
  competitionId: string;
  gameId: string;
  slateIds: string[];
  teamA: string;
  teamB: string;
}

const SLATE_SIZE = 4;

async function makeFixture(opts: {
  scoringModel?: "match_play" | "points";
  rollUp?: "team_totals" | "individual_matches";
  pointsTotal?: number | null;
}): Promise<Fixture> {
  const competitionId = await ctx.createCompetition(tripId, "pickem finalize cup", {
    ...(opts.scoringModel ? { scoringModel: opts.scoringModel } : {}),
  });

  // `createTeam`, not a hand-rolled insert: `teams.color_dim` is NOT NULL and a
  // literal row misses it. `team_assignments` has no `id` column at all.
  const teamA = await ctx.createTeam(competitionId, "Alpha");
  const teamB = await ctx.createTeam(competitionId, "Bravo");
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: teamA },
    { competition_id: competitionId, user_id: member, team_id: teamB },
  ]);

  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Finalize",
    competitionId,
  })) as { id: string };

  await ctx.admin
    .from("games")
    .update({ points_total: opts.pointsTotal === undefined ? 10 : opts.pointsTotal })
    .eq("id", g.id);

  await ctx.admin.from("pickem_games").upsert({
    game_id: g.id,
    picks_opened_at: new Date(Date.now() - 7_200_000).toISOString(),
    // Closed by default — the finalize refuses otherwise, which is case 1's
    // whole point. `openPicks` below puts a fixture back into the open state.
    picks_locked_at: new Date(Date.now() - 3_600_000).toISOString(),
    roll_up: opts.rollUp ?? "team_totals",
    use_confidence: true,
  });

  const slateIds = Array.from({ length: SLATE_SIZE }, () => genId("sg"));
  await ctx.admin.from("pickem_slate_games").insert(
    slateIds.map((id, i) => ({
      id,
      game_id: g.id,
      display_order: i,
      away_team: `Away${i}`,
      home_team: `Home${i}`,
      multiplier: 1,
      // Every contest resolved HOME, so a sheet's score is exactly the
      // confidence it spent on home picks.
      result: "home",
    }))
  );

  return { competitionId, gameId: g.id, slateIds, teamA, teamB };
}

/**
 * Write one person's sheet directly.
 *
 * Admin rather than the RPC on purpose: these cases are about what the FINALIZE
 * does with stored sheets, and routing through `save_pickem_picks` would make
 * every one of them also a test of the write gate — which has its own file, and
 * which refuses once picks are closed.
 */
async function seedSheet(
  f: Fixture,
  userId: string,
  /** Which slate indexes this person took HOME (i.e. correctly). */
  right: number[]
) {
  await ctx.admin.from("pickem_picks").delete().eq("game_id", f.gameId).eq("user_id", userId);
  await ctx.admin.from("pickem_picks").insert(
    f.slateIds.map((sgId, i) => ({
      id: genId("pp"),
      game_id: f.gameId,
      user_id: userId,
      slate_game_id: sgId,
      pick: right.includes(i) ? "home" : "away",
      confidence: SLATE_SIZE - i,
    }))
  );
}

/** Put the clock back into the picks-OPEN state. */
async function openPicks(f: Fixture) {
  await ctx.admin
    .from("pickem_games")
    .update({ picks_locked_at: null, picks_deadline: null })
    .eq("game_id", f.gameId);
}

async function closePicks(f: Fixture) {
  await ctx.admin
    .from("pickem_games")
    .update({ picks_locked_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("game_id", f.gameId);
}

function finish(f: Fixture) {
  return ctx.caller().games.finish({ tripId, gameId: f.gameId });
}

async function resultRows(f: Fixture) {
  const { data } = await ctx.admin
    .from("game_results")
    .select("entity_id, entity_type, position, raw_score")
    .eq("game_id", f.gameId);
  return (data ?? []) as {
    entity_id: string;
    entity_type: string;
    position: number | null;
    raw_score: number | null;
  }[];
}

async function totals(f: Fixture): Promise<Record<string, number>> {
  const board = await computeCompetitionLeaderboard(ctx.admin, f.competitionId);
  return (board.teamTotals ?? {}) as Record<string, number>;
}

async function dropFixture(f: Fixture) {
  await ctx.admin.from("game_results").delete().eq("game_id", f.gameId);
  await ctx.admin.from("pickem_picks").delete().eq("game_id", f.gameId);
  await ctx.admin.from("pickem_slate_games").delete().eq("game_id", f.gameId);
  await ctx.admin.from("game_matches").delete().eq("game_id", f.gameId);
  await ctx.admin.from("games").delete().eq("id", f.gameId);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("pickem finalize trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("the picks-open gate — why finalizing early is refused", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await makeFixture({ rollUp: "team_totals" });
    await seedSheet(f, owner, [0]); // owner takes one right: 4 points
    await seedSheet(f, member, [0, 1, 2, 3]); // member takes all four: 10 points
  });

  afterEach(async () => {
    await dropFixture(f);
  });

  it("REFUSES while picks are open, and names the tap that clears it", async () => {
    await openPicks(f);
    await expect(finish(f)).rejects.toThrow(/Close picking/i);
    // Nothing was written, and the game did not lock.
    expect(await resultRows(f)).toHaveLength(0);
    const { data } = await ctx.admin.from("games").select("status").eq("id", f.gameId).single();
    expect(data?.status).not.toBe("complete");
  });

  it("EVERY sheet counts once picking closes, not just the finalizer's", async () => {
    /**
     * The finalize runs as the OWNER, whose sheet is worth 4; the member's is
     * worth 10. So this fails against any build that scored only the caller —
     * and it is here rather than in the pure suite because "which sheets came
     * back" is a question about a database read.
     *
     * ── It is NOT evidence for the gate, and that is worth saying ───────────
     *
     * The first version of this file claimed RLS hid the member's sheet until
     * the lock, which would have made the gate a data-safety rule. MEASURED with
     * the gate removed and picks open: Bravo still won, 10 to 0.
     * `pickem_picks_select` has a proxy arm under which staff read every sheet,
     * and every caller who can finalize is staff. The gate is a domain rule —
     * see the wrapper's header — and this case is about the read being whole.
     */
    await closePicks(f);
    await finish(f);

    const t = await totals(f);
    expect(t[f.teamB]).toBe(10);
    expect(t[f.teamA]).toBe(0);
  });

  it("a game that NEVER opened is sent to Start picking, not to Close picking", async () => {
    /**
     * Two states under one predicate, and one message for both would send half
     * its readers to a button that is not on their screen — the refusal rule's
     * exact failure. Asserted as the OTHER sentence's absence too, because a
     * build that kept one message passes a bare "it throws".
     */
    await ctx.admin
      .from("pickem_games")
      .update({ picks_opened_at: null, picks_locked_at: null })
      .eq("game_id", f.gameId);
    await expect(finish(f)).rejects.toThrow(/Start picking/i);
    await expect(finish(f)).rejects.not.toThrow(/Close picking/i);
  });
});

describe("what gets persisted, and what the cup then pays", () => {
  let f: Fixture;
  afterEach(async () => {
    await dropFixture(f);
  });

  it("SIMPLE — the higher total takes the lot, stored as points", async () => {
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [3]);
    await finish(f);

    const rows = await resultRows(f);
    // POINTS, not a place: every row carries raw_score and no position.
    expect(rows.every((r) => r.position === null)).toBe(true);
    expect(rows.find((r) => r.entity_id === f.teamA)?.raw_score).toBe(10);
    // The losing team is WRITTEN, at zero — not omitted.
    expect(rows.find((r) => r.entity_id === f.teamB)?.raw_score).toBe(0);
    expect(rows).toHaveLength(2);

    const t = await totals(f);
    expect(t[f.teamA]).toBe(10);
    expect(t[f.teamB]).toBe(0);
  });

  it("a post-lock slate ADD does not change what the cup pays — #1150 end to end", async () => {
    /**
     * The only assertion that matters, and the one a column check cannot make.
     *
     * The RPC-level tests in `pickemSlateSave.test.ts` prove the ranks survive
     * the save. This proves the SCORE does — a build where confidence survives
     * the write but something downstream still reads it as zero would pass
     * those and fail here, and that is the failure the issue actually reported:
     * a decisive result silently becoming a tie and the cup splitting points
     * somebody won.
     *
     * Deliberately the ADD path only, and it stays that way — not because the
     * null-confidence question is still open (#1216 answered it: a cleared
     * rank scores 1, `pickConfidence`) but because nothing null enters this
     * test regardless: the added game has no `pickem_picks` row for anyone,
     * since nobody ranked a game that did not exist when they filled the sheet
     * in. The finalized-points assertion for a null-rank sheet lives in #1216's
     * own test, below.
     */
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await seedSheet(f, owner, [0, 1, 2, 3]); // all four right -> 4+3+2+1 = 10
    await seedSheet(f, member, [3]); // one right, at rank 1 -> 1

    // The runner adds a late game AFTER the lock. Through the real RPC, with
    // the real payload shape — a hand-rolled UPDATE would not exercise the
    // classification this is here to test.
    const late = genId("sg");
    await ctx.caller().pickem.saveConfig({
      tripId,
      gameId: f.gameId,
      slate: [
        ...f.slateIds.map((id, i) => ({
          id,
          awayTeam: `Away${i}`,
          homeTeam: `Home${i}`,
          multiplier: 1,
        })),
        { id: late, awayTeam: "Late", homeTeam: "Addition", multiplier: 1 },
      ],
    });

    await finish(f);

    // 10 vs 1 is decisive, so team_totals hands Alpha the whole pot. Under the
    // bug every rank was nulled, both sides scored 0, and this read 5 / 5.
    const t = await totals(f);
    expect(t[f.teamA]).toBe(10);
    expect(t[f.teamB]).toBe(0);

    // The added contest had no result and nobody picked it: it voids and pays
    // nothing, rather than dragging a phantom entrant into the standings.
    const rows = await resultRows(f);
    expect(rows).toHaveLength(2);
  });

  it("a null rank pays a real point, not nothing — #1216 end to end", async () => {
    /**
     * The only assertion that settles it. `pickemScoring.test.ts` proves the
     * per-pick VALUE; `pickemZeroReachability.test.ts` proves the board's own
     * PROJECTION. Neither can see a fix that landed in one of the two callers
     * of `pickConfidence` and not the other — `buildBoardRows` and this file's
     * `finish()` both run through it, so only an assertion on what the cup
     * actually PAYS closes that gap.
     *
     * Built to FLIP under the old formula, not merely to differ from it: Alpha
     * ranks one correct pick at confidence 1 (score 1). Bravo gets every pick
     * right with every rank cleared. Fixed, Bravo's four picks score 1 each —
     * 4 beats Alpha's 1, and team_totals hands Bravo the whole 10-point pot.
     * Under the old `?? 0`, Bravo's total is 0, Alpha's 1 stands, and Alpha
     * wins the same pot instead — the winning TEAM changes, not just a number
     * on a row nobody would notice.
     */
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });

    // Alpha (owner): correct only on the lowest-confidence slot (index 3,
    // confidence 1 by seedSheet's SLATE_SIZE - i) — one real point.
    await seedSheet(f, owner, [3]);

    // Bravo (member): every pick right, every rank NULL. Not seedSheet — it
    // always writes a real confidence — a direct insert, the shape a wiped or
    // never-ranked sheet actually has in the table.
    await ctx.admin.from("pickem_picks").delete().eq("game_id", f.gameId).eq("user_id", member);
    await ctx.admin.from("pickem_picks").insert(
      f.slateIds.map((sgId) => ({
        id: genId("pp"),
        game_id: f.gameId,
        user_id: member,
        slate_game_id: sgId,
        pick: "home", // every contest resolves "home" (makeFixture)
        confidence: null,
      }))
    );

    await finish(f);

    const t = await totals(f);
    expect(t[f.teamB]).toBe(10); // Bravo: 4 correct picks x 1 point = 4, wins the pot
    expect(t[f.teamA]).toBe(0); // Alpha: 1 correct pick x 1 point = 1, loses it
  });

  it("A POINTS CUP stores POSITIONS, and the payout re-derives from the total", async () => {
    /**
     * The case a build that wrote points everywhere would pass at the rows and
     * fail here: the total is changed AFTER the finalize, and the board follows.
     * That is the property the shape exists for — a stored figure would have
     * frozen the payout to whatever the schedule said at Save.
     */
    f = await makeFixture({ scoringModel: "points", pointsTotal: 10 });
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [3]);
    await finish(f);

    const rows = await resultRows(f);
    expect(rows.find((r) => r.entity_id === f.teamA)?.position).toBe(1);
    expect(rows.find((r) => r.entity_id === f.teamB)?.position).toBe(2);

    expect((await totals(f))[f.teamA]).toBe(10);

    await ctx.admin.from("games").update({ points_total: 25 }).eq("id", f.gameId);
    // No re-finalize. The rows are untouched; only the schedule moved.
    expect((await totals(f))[f.teamA]).toBe(25);
  });

  it("INDIVIDUAL MATCHES pays each match its share, and the cup sees it", async () => {
    f = await makeFixture({ rollUp: "individual_matches", pointsTotal: 6 });
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [3]);
    await ctx.admin.from("game_matches").insert({
      id: genId("gm"),
      game_id: f.gameId,
      display_order: 0,
      side_a: { type: "user", id: owner },
      side_b: { type: "user", id: member },
    });
    await finish(f);

    expect((await totals(f))[f.teamA]).toBe(6);
    expect((await totals(f))[f.teamB]).toBe(0);
  });

  it("re-running produces the SAME rows — a correction cycle cannot double a cup", async () => {
    /**
     * `games.finish` is deliberately re-runnable (openCorrection → edit →
     * finish), so an arm that INSERTED rather than replaced would pay the cup
     * twice on the second lock. `scope: "all"` is what prevents it, and nothing
     * about the awards themselves would reveal the difference.
     */
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [3]);

    await finish(f);
    const first = await totals(f);
    await ctx.admin.from("games").update({ corrections_open: true }).eq("id", f.gameId);
    await finish(f);

    expect(await resultRows(f)).toHaveLength(2);
    expect((await totals(f))[f.teamA]).toBe(first[f.teamA]);
  });

  it("a CORRECTED result changes the award — the recompute is not a no-op", async () => {
    // The other half of re-runnability: identical inputs give identical output
    // (above), and changed inputs give changed output. Without this, "same rows"
    // is satisfied by an arm that never recomputes at all.
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [3]);
    await finish(f);
    expect((await totals(f))[f.teamA]).toBe(10);

    await ctx.admin.from("games").update({ corrections_open: true }).eq("id", f.gameId);
    // Every contest flips to away, so the sheets swap: the owner now has none
    // right and the member has three.
    await ctx.admin
      .from("pickem_slate_games")
      .update({ result: "away" })
      .eq("game_id", f.gameId);
    await finish(f);

    expect((await totals(f))[f.teamB]).toBe(10);
    expect((await totals(f))[f.teamA]).toBe(0);
  });

  it("VOIDS the contests that had no result, and writes it", async () => {
    /**
     * WRITTEN, not derived. Leaving them at NULL was arithmetically identical —
     * both pay nobody — but it left a fourth state on the screen: rows above the
     * ENTERED list with no label and no controls, entered as nothing.
     *
     * "Had no result at finalize time" is not something the data remembers, so
     * there is nothing to derive it from later. The runner agreed to the void in
     * the confirm; this is the record of it.
     */
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await ctx.admin
      .from("pickem_slate_games")
      .update({ result: null })
      .eq("game_id", f.gameId)
      .in("id", [f.slateIds[2], f.slateIds[3]]);
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [2, 3]);
    await finish(f);

    const { data } = await ctx.admin
      .from("pickem_slate_games")
      .select("id, result")
      .eq("game_id", f.gameId);
    const byId = new Map((data ?? []).map((r) => [r.id as string, r.result as string | null]));
    expect(byId.get(f.slateIds[2])).toBe("cancelled");
    expect(byId.get(f.slateIds[3])).toBe("cancelled");
    // The ones that HAD a result keep it — voiding is for the outstanding ones,
    // not a sweep of the slate.
    expect(byId.get(f.slateIds[0])).toBe("home");
    expect(byId.get(f.slateIds[1])).toBe("home");
    // Nothing is left unresolved afterwards, which is the state the screen had
    // no way to render.
    expect([...byId.values()].filter((r) => r == null)).toHaveLength(0);
  });

  it("a CORRECTION un-voids it and the game recomputes — the reversibility", async () => {
    /**
     * THE CASE THAT MAKES FINALIZING EARLY A DECISION RATHER THAN A LOSS, and
     * the one worth proving rather than asserting in principle: Correct a result
     * reopens the game, the runner enters the real outcome over the void, and
     * re-finalizing pays it out.
     *
     * The award moves as a result — a build where the void stuck, or where the
     * recompute read the old value, would leave the totals where they were.
     */
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    // Only the last contest resolves; the other three are voided at finalize.
    await ctx.admin
      .from("pickem_slate_games")
      .update({ result: null })
      .eq("game_id", f.gameId)
      .in("id", [f.slateIds[0], f.slateIds[1], f.slateIds[2]]);
    // The member's whole sheet rides on the games that will be voided.
    await seedSheet(f, owner, [3]);
    await seedSheet(f, member, [0, 1, 2]);

    await finish(f);
    expect((await totals(f))[f.teamA]).toBe(10);
    expect((await totals(f))[f.teamB]).toBe(0);

    /**
     * The row is VOID before the correction — asserted, because without it this
     * case passes against a build that never voided anything. It would then be
     * testing "a result can be entered and the game recomputes", which is true
     * of the pre-void behaviour and is not what this is for.
     */
    const voided = await ctx.admin
      .from("pickem_slate_games")
      .select("result")
      .eq("id", f.slateIds[0])
      .single();
    expect(voided.data?.result).toBe("cancelled");

    // Reopen, enter the real outcome over the void, re-lock.
    await ctx.admin.from("games").update({ corrections_open: true }).eq("id", f.gameId);
    const { error } = await ctx.authedClient("owner").rpc("set_pickem_result", {
      p_game_id: f.gameId,
      p_slate_game_id: f.slateIds[0],
      p_result: "home",
    });
    expect(error).toBeNull();
    await finish(f);

    const { data } = await ctx.admin
      .from("pickem_slate_games")
      .select("result")
      .eq("id", f.slateIds[0])
      .single();
    expect(data?.result).toBe("home");
    // The member's top-ranked pick now pays, and the cup follows.
    expect((await totals(f))[f.teamB]).toBe(10);
    expect((await totals(f))[f.teamA]).toBe(0);
  });

  it("finalizes with contests UNRESOLVED — they score nothing, and nothing refuses", async () => {
    // A postponed Tuesday game must not hold the cup open. The runner is warned
    // (`unresolvedWarning`) and allowed to mean it.
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await ctx.admin
      .from("pickem_slate_games")
      .update({ result: null })
      .eq("game_id", f.gameId)
      .in("id", [f.slateIds[2], f.slateIds[3]]);
    await seedSheet(f, owner, [0, 1, 2, 3]);
    await seedSheet(f, member, [2, 3]);
    await finish(f);

    // Owner banked the two that resolved (4 + 3); the member's two correct picks
    // were both on unresolved games and paid nothing.
    expect((await totals(f))[f.teamA]).toBe(10);
    expect((await totals(f))[f.teamB]).toBe(0);
  });

  it("a sheet with a CLEARED pick is not scored as a pick", async () => {
    // Migration 166 stores partial sheets, so a row can carry a null side. It is
    // an untouched game, not a wager on the away team.
    f = await makeFixture({ rollUp: "team_totals", pointsTotal: 10 });
    await seedSheet(f, owner, [0]);
    await seedSheet(f, member, []);
    await ctx.admin
      .from("pickem_picks")
      .update({ pick: null })
      .eq("game_id", f.gameId)
      .eq("user_id", member);

    await finish(f);
    // The owner's single correct pick beats an empty sheet; nothing throws on
    // the null rows.
    expect((await totals(f))[f.teamA]).toBe(10);
    expect((await totals(f))[f.teamB]).toBe(0);
  });
});
