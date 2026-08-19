import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #951/#997 — removing a member must not destroy a RESULT.
 *
 * THE RULE (corrected in #997): participation without a result is a PLAN;
 * participation with a result is HISTORY. Plans are removable, history is not.
 * Being slotted into a game nobody has scored, or drawn into a bracket nobody
 * has played, is a plan — remove them and the slot becomes a bye. The earlier
 * version of this guard blocked on a bare `game_participants` row, which was
 * stricter than the rule it was trying to enforce.
 *
 * Before this guard the removal was a SILENT SUCCESS: `trip_members` went, and
 * every scoring row stayed, because those tables key to `users` rather than to
 * `trip_members` so nothing cascades and nothing errors. It surfaced later as a
 * scorecard row reading "Player".
 *
 * The two cases are deliberately separated, because ~40% of a real roster is in
 * the second one and the common case must stay clean and silent:
 *   no participation  -> removal succeeds, unchanged behaviour
 *   participation     -> refused, NOTHING deleted
 *
 * Both removal paths are covered. #957 was exactly a guard present in one
 * procedure and missing from its sibling, and `ghostCrew.remove` is this one's
 * sibling.
 */

const STROKE = "gtt_stroke_play";
let ctx: TestContext;
let tripId: string;

async function makeGameWith(userId: string, opts: { withScore: boolean; name: string }) {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: opts.name })) as { id: string };
  await ctx.admin.from("game_participants").insert({
    id: crypto.randomUUID(), game_id: g.id, user_id: userId,
  });
  if (opts.withScore) {
    await ctx.admin.from("score_entries").insert({
      id: crypto.randomUUID(), game_id: g.id, participant_id: userId,
      participant_type: "user", unit_label: "1", value: 4, submitted_by: userId,
    });
  }
  return g.id;
}

describe("#951 — removal refuses rather than orphaning participation", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Removal Guard Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Member");
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("ALLOWS removing a member with no participation (the common case)", async () => {
    const target = ctx.getUser("outsider").id;
    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).resolves.toMatchObject({ success: true });

    const { data } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", target).maybeSingle();
    expect(data).toBeNull();

    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: target, role: "Member", status: "in" });
  }, 60_000);

  it("REFUSES removing a member who has scores, and deletes NOTHING", async () => {
    const target = ctx.getUser("member").id;
    const gameId = await makeGameWith(target, { withScore: true, name: "Saturday Stroke" });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // The membership survives — a refusal must not half-apply.
    const { data: tm } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", target).maybeSingle();
    expect(tm).toMatchObject({ user_id: target });

    const { data: gp } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect(gp).toHaveLength(1);

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);

  it("ALLOWS removal when they are only SLOTTED INTO a game nobody has scored", async () => {
    // INVERTED in #997, and this is the correction rather than a relaxation.
    // A participant row in an unplayed game is a PLAN: nothing has happened, so
    // nothing is destroyed by removing them. The previous version refused here,
    // which made tidying a roster before the trip needlessly hard.
    const target = ctx.getUser("member").id;
    const gameId = await makeGameWith(target, { withScore: false, name: "Not Started Yet" });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).resolves.toMatchObject({ success: true });

    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: target, role: "Member", status: "in" });
  }, 60_000);

  it("REFUSES once SOMEBODY has scored that game — the same slot becomes history", async () => {
    // The plan/result boundary, from the other side: the participant row is
    // identical; what changed is that the game has been played.
    const target = ctx.getUser("member").id;
    const other = ctx.getUser("outsider").id;
    const gameId = await makeGameWith(target, { withScore: false, name: "Now Underway" });
    await ctx.admin.from("score_entries").insert({
      id: crypto.randomUUID(), game_id: gameId, participant_id: other,
      participant_type: "user", unit_label: "1", value: 5, submitted_by: other,
    });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);

  it("the message NAMES the games and points at the documented workaround", async () => {
    const target = ctx.getUser("member").id;
    const gameId = await makeGameWith(target, { withScore: true, name: "Sunday Scramble" });

    let msg = "";
    try {
      await ctx.caller().tripMembers.remove({ tripId, userId: target });
    } catch (e) {
      msg = (e as Error).message;
    }
    // ~40% of a real roster hits this, so "no" on its own would be infuriating.
    expect(msg).toContain("Sunday Scramble");
    expect(msg).toMatch(/enter a score/i);
    expect(msg).toMatch(/rename them/i);

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);

  it("the count in the message matches the list under it (mixed case)", async () => {
    // Regression: an earlier message said "has scores in 1 game" and then named
    // TWO, because the count came from the scored subset while the list came
    // from all blockers. Found by looking at the rendered panel, not by a test.
    // Rebuilt for #997: the old fixture used an UNSCORED game as the second
    // blocker, which is now a plan and correctly no longer blocks. A genuine
    // mixed case needs two RESULTS of different kinds — scores in one game, a
    // recorded result in another.
    const target = ctx.getUser("member").id;
    const scoredGame = await makeGameWith(target, { withScore: true, name: "Has Scores" });
    const resultGame = await makeGameWith(target, { withScore: false, name: "Has A Result" });
    await ctx.admin.from("game_results").insert({
      id: crypto.randomUUID(), game_id: resultGame, entity_id: target,
      entity_type: "user", position: 1,
    });

    const info = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(info.blockers.games).toHaveLength(2);
    // Names BOTH, and does NOT claim both are scored.
    expect(info.message).toContain("Has Scores");
    expect(info.message).toContain("Has A Result");
    expect(info.message).toMatch(/results in 2 games, with scores in 1/);
    expect(info.message).not.toMatch(/has scores in 2 games/);

    await ctx.admin.from("game_results").delete().eq("game_id", resultGame);
    for (const id of [scoredGame, resultGame]) {
      await ctx.admin.from("score_entries").delete().eq("game_id", id);
      await ctx.admin.from("game_participants").delete().eq("game_id", id);
      await ctx.admin.from("games").delete().eq("id", id);
    }
  }, 60_000);

  it("ghostCrew.remove obeys the SAME rule — the sibling gap #957 warned about", async () => {
    const ghost = await ctx.caller().ghostCrew.create({ tripId, name: "Playing Placeholder" });
    const gameId = await makeGameWith(ghost.id, { withScore: true, name: "Ghost's Round" });

    await expect(
      ctx.caller().ghostCrew.remove({ tripId, guestUserId: ghost.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const { data: tm } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", ghost.id).maybeSingle();
    expect(tm).toMatchObject({ user_id: ghost.id });

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", ghost.id);
    await ctx.admin.from("users").delete().eq("id", ghost.id);
  }, 60_000);

  it("ghostCrew.remove still removes a placeholder who has NOT played", async () => {
    const ghost = await ctx.caller().ghostCrew.create({ tripId, name: "Never Played" });
    await expect(
      ctx.caller().ghostCrew.remove({ tripId, guestUserId: ghost.id })
    ).resolves.toMatchObject({ success: true });
    await ctx.admin.from("users").delete().eq("id", ghost.id);
  }, 60_000);

  it("removalBlockers reports the same verdict the mutation enforces", async () => {
    const target = ctx.getUser("member").id;
    const clean = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(clean.blocked).toBe(false);
    expect(clean.blockers.games).toEqual([]);
    expect(clean.message).toBeNull();

    const gameId = await makeGameWith(target, { withScore: true, name: "Blocker Probe" });
    const blocked = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockers.games).toHaveLength(1);
    expect(blocked.blockers.games[0]).toMatchObject({ gameName: "Blocker Probe", hasScores: true });
    expect(blocked.message).toContain("Blocker Probe");

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);
  // ── #997 — the plan/result boundary in the bracket, and receipts ─────────

  it("ALLOWS removal when they are only DRAWN INTO a bracket nobody has played", async () => {
    // The case that motivated the corrected rule. An entrant in an undecided
    // draw is a plan: remove them and the slot becomes a bye, which the tree
    // builder already handles at every entrant count.
    const target = ctx.getUser("member").id;
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE, name: "Undecided Draw",
    })) as { id: string };
    const entrantId = crypto.randomUUID();
    await ctx.admin.from("bracket_entrants").insert({ id: entrantId, game_id: g.id, seed: 1 });
    await ctx.admin.from("bracket_entrant_members").insert({ entrant_id: entrantId, user_id: target });
    await ctx.admin.from("bracket_matches").insert({
      id: crypto.randomUUID(), game_id: g.id, bracket: "main", round: 1, slot: 1,
      entrant_a_id: entrantId, winner_entrant_id: null,
    });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).resolves.toMatchObject({ success: true });

    await ctx.admin.from("bracket_matches").delete().eq("game_id", g.id);
    await ctx.admin.from("bracket_entrant_members").delete().eq("entrant_id", entrantId);
    await ctx.admin.from("bracket_entrants").delete().eq("id", entrantId);
    await ctx.admin.from("games").delete().eq("id", g.id);
    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: target, role: "Member", status: "in" });
  }, 60_000);

  it("REFUSES once that bracket match has a WINNER — the draw became a result", async () => {
    // Same rows as the test above plus one: winner_entrant_id. That single
    // column is the whole plan/result boundary for a bracket. Note the guard
    // never reads `bracket_matches.bracket`, so the double-elim structure work
    // cannot change this verdict.
    const target = ctx.getUser("member").id;
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE, name: "Decided Semi",
    })) as { id: string };
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await ctx.admin.from("bracket_entrants").insert([
      { id: a, game_id: g.id, seed: 1 }, { id: b, game_id: g.id, seed: 2 },
    ]);
    await ctx.admin.from("bracket_entrant_members").insert({ entrant_id: a, user_id: target });
    await ctx.admin.from("bracket_matches").insert({
      id: crypto.randomUUID(), game_id: g.id, bracket: "main", round: 1, slot: 1,
      entrant_a_id: a, entrant_b_id: b, winner_entrant_id: b,
    });

    // Blocked even though they LOST — a decided match involving them is history
    // whichever way it went.
    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await ctx.admin.from("bracket_matches").delete().eq("game_id", g.id);
    await ctx.admin.from("bracket_entrant_members").delete().in("entrant_id", [a, b]);
    await ctx.admin.from("bracket_entrants").delete().in("id", [a, b]);
    await ctx.admin.from("games").delete().eq("id", g.id);
  }, 60_000);

  it("REFUSES on a DECIDED match they were a side of (the JSONB no FK can see)", async () => {
    const target = ctx.getUser("member").id;
    const g = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE, name: "Settled Match",
    })) as { id: string };
    await ctx.admin.from("game_matches").insert({
      id: crypto.randomUUID(), game_id: g.id, match_number: 1,
      side_a: { type: "user", id: target }, side_b: { type: "user", id: ctx.getUser("outsider").id },
      result: "a", status: "complete",
    });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await ctx.admin.from("game_matches").delete().eq("game_id", g.id);
    await ctx.admin.from("games").delete().eq("id", g.id);
  }, 60_000);

  it("REFUSES when they PAID for an expense", async () => {
    const target = ctx.getUser("member").id;
    const expenseId = crypto.randomUUID();
    await ctx.admin.from("expenses").insert({
      id: expenseId, trip_id: tripId, title: "Green fees", amount: 400, paid_by_user_id: target,
    });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await ctx.admin.from("expenses").delete().eq("id", expenseId);
  }, 60_000);

  it("REFUSES when they are SPLIT INTO someone else's expense", async () => {
    // The least obvious category, and the one an owner's mental model misses:
    // "Charlie hasn't done anything" is true right up until you notice that
    // removing him changes what everyone else owes, because the total no longer
    // reconciles.
    const target = ctx.getUser("member").id;
    const payer = ctx.getUser("outsider").id;
    const expenseId = crypto.randomUUID();
    await ctx.admin.from("expenses").insert({
      id: expenseId, trip_id: tripId, title: "Dinner", amount: 300, paid_by_user_id: payer,
    });
    await ctx.admin.from("expense_splits").insert([
      { expense_id: expenseId, user_id: payer, amount: 150 },
      { expense_id: expenseId, user_id: target, amount: 150 },
    ]);

    const info = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(info.blocked).toBe(true);
    expect(info.blockers.expenseSplits).toBe(1);
    expect(info.blockers.expensesPaid).toBe(0);
    expect(info.message).toMatch(/split into 1 expense/i);

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await ctx.admin.from("expense_splits").delete().eq("expense_id", expenseId);
    await ctx.admin.from("expenses").delete().eq("id", expenseId);
  }, 60_000);

  it("lists EVERY category with correct counts when several apply at once", async () => {
    const target = ctx.getUser("member").id;
    const payer = ctx.getUser("outsider").id;
    const gameId = await makeGameWith(target, { withScore: true, name: "Multi Round" });

    const paidId = crypto.randomUUID();
    await ctx.admin.from("expenses").insert({
      id: paidId, trip_id: tripId, title: "Cart hire", amount: 90, paid_by_user_id: target,
    });
    const splitIds = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of splitIds) {
      await ctx.admin.from("expenses").insert({
        id, trip_id: tripId, title: "Shared", amount: 60, paid_by_user_id: payer,
      });
      await ctx.admin.from("expense_splits").insert({ expense_id: id, user_id: target, amount: 30 });
    }

    const info = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(info.blockers.games).toHaveLength(1);
    expect(info.blockers.expensesPaid).toBe(1);
    expect(info.blockers.expenseSplits).toBe(2);
    // All three categories present, with their own counts — a single generic
    // refusal is what this message exists not to be.
    expect(info.message).toContain("Multi Round");
    expect(info.message).toMatch(/paid for 1 expense/i);
    expect(info.message).toMatch(/split into 2 more/i);

    await ctx.admin.from("expense_splits").delete().in("expense_id", splitIds);
    await ctx.admin.from("expenses").delete().in("id", [paidId, ...splitIds]);
    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);
});
