import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Removing someone with history (#951/#997, revised by PR 8d).
 *
 * #951 made removal REFUSE anyone with history, because removal used to delete
 * the membership and leave every scoring row behind with nothing to name it.
 * PR 8d replaced that with an ARCHIVE (ruling 19): history is kept, the person
 * leaves, and a departure record carries the name the crew saw. Refusing made
 * removal impossible on any trip that had been played, so it stopped (ruling 2:
 * warn, never block).
 *
 * So every case below now asserts TWO things:
 *   - the PREDICATE (`findContributionBlockers`, via `departureSummary`) still
 *     gives the verdict it gave before. It no longer gates anything: since
 *     PR 8d-3 it is what the remove and leave WARNINGS list.
 *   - removal SUCCEEDS, and the specific history row the case is about is
 *     still there afterwards — the mechanism, not just "it didn't throw".
 *
 * THE PLAN/RESULT RULE the predicate encodes (#997) is unchanged: participation
 * without a result is a PLAN; with a result it is HISTORY.
 *
 * Each case builds its own trip: removal is a destructive write (CLAUDE.md).
 */

const STROKE = "gtt_stroke_play";
let ctx: TestContext;
let member: string;
let outsider: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 90_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function trip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Removal ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  return tripId;
}

async function makeGameWith(tripId: string, userId: string, opts: { withScore: boolean; name: string }) {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: opts.name })) as { id: string };
  await seed("game_participants", { id: crypto.randomUUID(), game_id: g.id, user_id: userId });
  if (opts.withScore) {
    await seed("score_entries", {
      id: crypto.randomUUID(), game_id: g.id, participant_id: userId,
      participant_type: "user", unit_label: "1", value: 4, submitted_by: userId,
    });
  }
  return g.id;
}

/**
 * Insert a fixture row, failing LOUDLY. A fixture that silently fails to insert
 * passes by absence — this file once blamed the guard for `result: "a"`, which
 * violates `game_matches_result_check` and never inserted at all.
 */
async function seed(table: string, rows: Record<string, unknown> | Record<string, unknown>[]) {
  const { error } = await ctx.admin.from(table).insert(rows as never);
  if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
}

async function isMember(tripId: string, userId: string) {
  const { count, error } = await ctx.admin.from("trip_members")
    .select("user_id", { count: "exact", head: true }).eq("trip_id", tripId).eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function rowCount(table: string, filters: Record<string, string>) {
  let q = ctx.admin.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Remove through the router; assert it succeeded and the membership ended. */
async function removeOk(tripId: string, userId: string) {
  await expect(ctx.caller().tripMembers.remove({ tripId, userId })).resolves.toMatchObject({ success: true });
  expect(await isMember(tripId, userId)).toBe(false);
}

describe("removal archives instead of refusing", () => {
  it("no participation: nothing to warn about, and the removal goes through (the common case)", async () => {
    const tripId = await trip("plain");
    const info = await ctx.caller().tripMembers.departureSummary({ tripId, userId: outsider });
    expect(info.hasHistory).toBe(false);
    expect(info.ownerRefusal).toBeNull();
    await removeOk(tripId, outsider);
  });

  it("scores in a game: the panel still says so; removal goes through and the SCORES STAY", async () => {
    const tripId = await trip("scores");
    const gameId = await makeGameWith(tripId, member, { withScore: true, name: "Saturday Stroke" });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(true);

    await removeOk(tripId, member);
    expect(await rowCount("score_entries", { game_id: gameId, participant_id: member })).toBe(1);
  });

  it("only SLOTTED INTO a game nobody has scored: a plan, so no warning", async () => {
    const tripId = await trip("slotted");
    await makeGameWith(tripId, member, { withScore: false, name: "Not Started Yet" });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(false);
    await removeOk(tripId, member);
  });

  it("once SOMEBODY has scored that game, the same slot is history: warned, and the other's score stays", async () => {
    const tripId = await trip("underway");
    const gameId = await makeGameWith(tripId, member, { withScore: false, name: "Now Underway" });
    await seed("score_entries", {
      id: crypto.randomUUID(), game_id: gameId, participant_id: outsider,
      participant_type: "user", unit_label: "1", value: 5, submitted_by: outsider,
    });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(true);

    await removeOk(tripId, member);
    expect(await rowCount("score_entries", { game_id: gameId, participant_id: outsider })).toBe(1);
  });

  it("the warning lists BOTH kinds of game, each marked for what it holds (mixed case)", async () => {
    // The panel renders this list directly, one line per game with its own
    // marker — there is no separate count to disagree with it any more (the
    // refusal sentence that once said "scores in 1 game" and named two is gone
    // with the refusal, PR 8d-3).
    const tripId = await trip("mixed");
    await makeGameWith(tripId, member, { withScore: true, name: "Has Scores" });
    const resultGame = await makeGameWith(tripId, member, { withScore: false, name: "Has A Result" });
    await seed("game_results", {
      id: crypto.randomUUID(), game_id: resultGame, entity_id: member,
      entity_type: "user", value_kind: "rank", position: 1,
    });

    const info = await ctx.caller().tripMembers.departureSummary({ tripId, userId: member });
    const byName = Object.fromEntries(info.history.games.map((g) => [g.gameName, g.hasScores]));
    expect(byName).toEqual({ "Has Scores": true, "Has A Result": false });
  });

  it("ghostCrew.remove takes the SAME path: a placeholder who has played is removed and KEPT, with their scores", async () => {
    const tripId = await trip("ghost played");
    const ghost = (await ctx.caller().ghostCrew.create({ tripId, name: "Playing Placeholder" })) as { id: string };
    const gameId = await makeGameWith(tripId, ghost.id, { withScore: true, name: "Ghost's Round" });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: ghost.id })).hasHistory).toBe(true);

    await expect(ctx.caller().ghostCrew.remove({ tripId, guestUserId: ghost.id })).resolves.toMatchObject({ success: true });
    expect(await isMember(tripId, ghost.id)).toBe(false);
    expect(await rowCount("score_entries", { game_id: gameId, participant_id: ghost.id })).toBe(1);
    // History, so the departure exists and the users row survives the
    // orphan-guest delete that runs after the archive.
    expect(await rowCount("trip_departures", { trip_id: tripId, user_id: ghost.id })).toBe(1);
    expect(await rowCount("users", { id: ghost.id })).toBe(1);
  });

  it("ghostCrew.remove: a placeholder who has NOT played leaves no record and is deleted, as before", async () => {
    const tripId = await trip("ghost unplayed");
    const ghost = (await ctx.caller().ghostCrew.create({ tripId, name: "Never Played" })) as { id: string };
    await expect(ctx.caller().ghostCrew.remove({ tripId, guestUserId: ghost.id })).resolves.toMatchObject({ success: true });
    expect(await rowCount("trip_departures", { trip_id: tripId, user_id: ghost.id })).toBe(0);
    expect(await rowCount("users", { id: ghost.id })).toBe(0);
  });

  it("departureSummary: clean before history exists, and names the game once it does", async () => {
    const tripId = await trip("verdict");
    const clean = await ctx.caller().tripMembers.departureSummary({ tripId, userId: member });
    expect(clean.hasHistory).toBe(false);
    expect(clean.history.games).toEqual([]);

    await makeGameWith(tripId, member, { withScore: true, name: "Blocker Probe" });
    const played = await ctx.caller().tripMembers.departureSummary({ tripId, userId: member });
    expect(played.hasHistory).toBe(true);
    expect(played.history.games).toHaveLength(1);
    expect(played.history.games[0]).toMatchObject({ gameName: "Blocker Probe", hasScores: true });
  });

  // ── #997 — the plan/result boundary in the bracket, and receipts ─────────

  it("only DRAWN INTO a bracket nobody has played: a plan, so no warning", async () => {
    const tripId = await trip("draw");
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Undecided Draw" })) as { id: string };
    const entrantId = crypto.randomUUID();
    await seed("bracket_entrants", { id: entrantId, game_id: g.id, seed: 1 });
    await seed("bracket_entrant_members", { entrant_id: entrantId, user_id: member });
    await seed("bracket_matches", {
      id: crypto.randomUUID(), game_id: g.id, bracket: "main", round: 1, slot: 1,
      entrant_a_id: entrantId, winner_entrant_id: null,
    });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(false);
    await removeOk(tripId, member);
  });

  it("once that bracket match has a WINNER it is history: warned, and the decided match stays exactly as it was", async () => {
    // The archive does not touch brackets yet (8d-2's bracket withdrawal is its
    // own PR), so the draw and its winner survive untouched.
    const tripId = await trip("decided semi");
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Decided Semi" })) as { id: string };
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await seed("bracket_entrants", [{ id: a, game_id: g.id, seed: 1 }, { id: b, game_id: g.id, seed: 2 }]);
    await seed("bracket_entrant_members", { entrant_id: a, user_id: member });
    const matchId = crypto.randomUUID();
    await seed("bracket_matches", {
      id: matchId, game_id: g.id, bracket: "main", round: 1, slot: 1,
      entrant_a_id: a, entrant_b_id: b, winner_entrant_id: b,
    });
    // Warned even though they LOST — a decided match is history either way.
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(true);

    await removeOk(tripId, member);
    const { data: m } = await ctx.admin.from("bracket_matches").select("entrant_a_id, winner_entrant_id").eq("id", matchId).single();
    expect(m).toEqual({ entrant_a_id: a, winner_entrant_id: b });
    expect(await rowCount("bracket_entrant_members", { entrant_id: a, user_id: member })).toBe(1);
  });

  it("a DECIDED match they were a side of (the JSONB no FK can see): warned, and the seat is KEPT (migration 207)", async () => {
    const tripId = await trip("settled match");
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Settled Match" })) as { id: string };
    const matchId = crypto.randomUUID();
    await seed("game_matches", {
      id: matchId, game_id: g.id, match_number: 1,
      side_a: { type: "user", id: member }, side_b: { type: "user", id: outsider },
      result: "a_win", status: "complete",
    });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(true);

    await removeOk(tripId, member);
    const { data: m } = await ctx.admin.from("game_matches").select("side_a, result").eq("id", matchId).single();
    expect(m).toEqual({ side_a: { type: "user", id: member }, result: "a_win" });
  });

  it("they PAID for an expense: warned, and the expense stays theirs (money warns, never blocks)", async () => {
    const tripId = await trip("paid");
    const expenseId = crypto.randomUUID();
    await seed("expenses", { id: expenseId, trip_id: tripId, title: "Green fees", amount: 400, paid_by_user_id: member });
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member })).hasHistory).toBe(true);

    await removeOk(tripId, member);
    expect(await rowCount("expenses", { id: expenseId, paid_by_user_id: member })).toBe(1);
  });

  it("they are SPLIT INTO someone else's expense: warned with the count, and the split stays", async () => {
    // The least obvious category: "Charlie hasn't done anything" is true right
    // up until you notice removing him would change what everyone else owes.
    const tripId = await trip("split");
    const expenseId = crypto.randomUUID();
    await seed("expenses", { id: expenseId, trip_id: tripId, title: "Dinner", amount: 300, paid_by_user_id: outsider });
    await seed("expense_splits", [
      { expense_id: expenseId, user_id: outsider, amount: 150 },
      { expense_id: expenseId, user_id: member, amount: 150 },
    ]);

    const info = await ctx.caller().tripMembers.departureSummary({ tripId, userId: member });
    expect(info.hasHistory).toBe(true);
    expect(info.history.expenseSplits).toBe(1);
    expect(info.history.expensesPaid).toBe(0);

    await removeOk(tripId, member);
    expect(await rowCount("expense_splits", { expense_id: expenseId, user_id: member })).toBe(1);
  });

  it("the panel lists EVERY category with correct counts when several apply at once", async () => {
    const tripId = await trip("every category");
    await makeGameWith(tripId, member, { withScore: true, name: "Multi Round" });
    await seed("expenses", { id: crypto.randomUUID(), trip_id: tripId, title: "Cart hire", amount: 90, paid_by_user_id: member });
    for (let i = 0; i < 2; i++) {
      const id = crypto.randomUUID();
      await seed("expenses", { id, trip_id: tripId, title: "Shared", amount: 60, paid_by_user_id: outsider });
      await seed("expense_splits", { expense_id: id, user_id: member, amount: 30 });
    }

    const info = await ctx.caller().tripMembers.departureSummary({ tripId, userId: member });
    expect(info.history.games).toHaveLength(1);
    expect(info.history.expensesPaid).toBe(1);
    expect(info.history.expenseSplits).toBe(2);
    expect(info.history.games.map((g) => g.gameName)).toEqual(["Multi Round"]);
  });
});
