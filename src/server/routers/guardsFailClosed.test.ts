import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1469 — a guard whose read FAILS must fail CLOSED, never open.
 *
 * Each of these guards decides whether a destructive write may happen from a
 * read. Unchecked, a failed read became the permissive answer ("no votes", "no
 * scores", "not on a team", "scoring is off") and the write went through. Each
 * case below fails EXACTLY that one read (`callerFailingRead`: table + the exact
 * column string, so the middleware's own reads still succeed) and asserts:
 *
 *  - the refusal is the family's own sentence ("Couldn't check the …") — a
 *    failure from any other door would produce a different one, so the case
 *    cannot pass by accident;
 *  - the destructive write DID NOT happen (the row is still there / unchanged).
 *
 * Beside each, a CONTROL on real reads shows the write IS reachable (or that the
 * guard's own ordinary refusal fires), so "nothing happened" in the failing case
 * means the guard stopped it — not that the test watched the wrong door.
 */

const SENTENCE = (what: string) => `Couldn't check the ${what} just now. This is temporary — try again in a moment.`;

let ctx: TestContext;
let tripId: string;
let member: string;
let cup: string;
let teamA: string, teamB: string, teamC: string;
let scoredGame: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Guards fail closed");
  await ctx.addTripMember(tripId, "member", "Member");
  member = ctx.getUser("member").id;

  // A SCORED points cup: three teams (a points race may lose one), member on A.
  cup = await ctx.createCompetition(tripId, "Scored cup", { scoringModel: "points" });
  teamA = await ctx.createTeam(cup, "Alpha");
  teamB = await ctx.createTeam(cup, "Bravo");
  teamC = await ctx.createTeam(cup, "Charlie");
  await ctx.assignTeam(cup, teamA, [member]);
  scoredGame = genId("game");
  const g = await ctx.admin.from("games").insert({
    id: scoredGame, trip_id: tripId, competition_id: cup, game_type_id: "gtt_stroke_play",
    name: "Scored", status: "active", scoring_enabled: true, entry_mode: "score",
    scorecard_schema: { units: { count: 9, label: "hole" } },
  });
  if (g.error) throw new Error(`seed game: ${g.error.message}`);
  const se = await ctx.admin.from("score_entries").insert({
    id: genId("se"), game_id: scoredGame, participant_id: member, participant_type: "user", unit_label: "1", value: 4,
  });
  if (se.error) throw new Error(`seed score: ${se.error.message}`);
}, 120_000);

/**
 * Every case starts from the same roster: member on Alpha, all three teams
 * present. Without this a destructive write that got through in ONE case (which
 * is exactly what a regression — or the fail-open mutant — produces) changed the
 * starting state of the next: the mutant run showed the roster-lock case's
 * removal turning the later MOVE control into an ADD, so an unrelated control
 * went red. Each case now stands alone, and a red names its own guard.
 */
beforeEach(async () => {
  await ctx.admin.from("team_assignments").upsert(
    { competition_id: cup, team_id: teamA, user_id: member },
    { onConflict: "competition_id,user_id" },
  );
});

afterAll(async () => {
  await ctx.admin.from("score_entries").delete().eq("game_id", scoredGame);
  await ctx.cleanup();
}, 60_000);

describe("datePoll.unlock — a failed vote count never deletes a window that has votes", () => {
  async function lockedWindow(withVote: boolean): Promise<string> {
    const w = genId("win");
    await ctx.admin.from("date_windows").insert({ id: w, trip_id: tripId, start_date: "2026-10-01", end_date: "2026-10-03" });
    if (withVote) await ctx.admin.from("date_poll_votes").insert({ window_id: w, user_id: member, answer: "yes" });
    await ctx.admin.from("date_polls").upsert({ trip_id: tripId, open: false, locked_window_id: w }, { onConflict: "trip_id" });
    return w;
  }
  const exists = async (w: string) =>
    (await ctx.admin.from("date_windows").select("id", { count: "exact", head: true }).eq("id", w)).count;

  it("CONTROL: the door is real — an UNVOTED locked window is deleted by unlock", async () => {
    const w = await lockedWindow(false);
    await ctx.caller().datePoll.unlock({ tripId });
    expect(await exists(w)).toBe(0);
  }, 60_000);

  it("a FAILED count refuses, and the voted window and its vote survive", async () => {
    const w = await lockedWindow(true);
    const failing = callerFailingRead(ctx, "owner", { table: "date_poll_votes", columns: "window_id" });
    await expect(failing.datePoll.unlock({ tripId })).rejects.toThrow(SENTENCE("date window's votes"));
    expect(await exists(w)).toBe(1);
    const { count: votes } = await ctx.admin.from("date_poll_votes").select("window_id", { count: "exact", head: true }).eq("window_id", w);
    expect(votes).toBe(1);
  }, 60_000);
});

describe("the roster lock — a failed games read never opens it on a scored cup", () => {
  it("CONTROL: real reads — removing a player from a scored cup is refused as LOCKED", async () => {
    await expect(ctx.caller().teamAssignments.remove({ tripId, competitionId: cup, userId: member })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }, 60_000);

  it("a FAILED games read refuses — it does not read as 'no games' and remove the player", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "games", columns: "id" });
    await expect(failing.teamAssignments.remove({ tripId, competitionId: cup, userId: member })).rejects.toThrow(SENTENCE("cup's games"));
    const { count } = await ctx.admin.from("team_assignments").select("user_id", { count: "exact", head: true })
      .eq("competition_id", cup).eq("user_id", member);
    expect(count).toBe(1);
  }, 60_000);
});

describe("teamAssignments.assign — a failed read never lets a MOVE past the lock", () => {
  it("CONTROL: real reads — moving a player on a scored cup is refused as LOCKED", async () => {
    await expect(ctx.caller().teamAssignments.assign({ tripId, competitionId: cup, userId: member, teamId: teamB })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }, 60_000);

  it("a FAILED read of the player's team refuses — the player stays on Alpha", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "team_assignments", columns: "team_id" });
    await expect(failing.teamAssignments.assign({ tripId, competitionId: cup, userId: member, teamId: teamB })).rejects.toThrow(
      SENTENCE("player's current team"),
    );
    const { data } = await ctx.admin.from("team_assignments").select("team_id").eq("competition_id", cup).eq("user_id", member).single();
    expect((data as { team_id: string }).team_id).toBe(teamA);
  }, 60_000);
});

describe("teams.delete — a failed team read never skips both guards", () => {
  // Charlie carries banked points. Until PR 8b this control leaned on the roster
  // LOCK (any team in a scored cup was undeletable); 8b lifted it, and an empty
  // team with nothing banked is now correctly deletable. So the refusal the
  // control proves is the one 8b kept: a team with banked points cannot vanish.
  beforeAll(async () => {
    const done = genId("gfc-done");
    const g = await ctx.admin.from("games").insert({
      id: done, trip_id: tripId, competition_id: cup, game_type_id: "gtt_manual", name: "Banked", status: "complete",
    });
    if (g.error) throw new Error(`games insert failed: ${g.error.message}`);
    const r = await ctx.admin.from("game_results").insert({
      id: genId("gfc-gr"), game_id: done, entity_type: "team", entity_id: teamC,
      credited_team_id: teamC, position: 1, value_kind: "rank",
    });
    if (r.error) throw new Error(`game_results insert failed: ${r.error.message}`);
  });

  it("CONTROL: real reads — deleting a team with banked points is refused, by name", async () => {
    await expect(ctx.caller().teams.delete({ tripId, teamId: teamC })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: expect.stringContaining("Charlie has results banked"),
    });
  }, 60_000);

  it("a FAILED team read refuses — the team is not deleted", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "teams", columns: "competition_id, name" });
    await expect(failing.teams.delete({ tripId, teamId: teamC })).rejects.toThrow(SENTENCE("team"));
    const { count } = await ctx.admin.from("teams").select("id", { count: "exact", head: true }).eq("id", teamC);
    expect(count).toBe(1);
  }, 60_000);
});

describe("the course freeze — a failed score count never opens it", () => {
  const schemaOf = async () =>
    ((await ctx.admin.from("games").select("scorecard_schema").eq("id", scoredGame).single()).data as { scorecard_schema: unknown })
      .scorecard_schema;

  it("CONTROL: real reads — clearing the course of a scored game is refused", async () => {
    await expect(ctx.caller().games.clearCourse({ tripId, gameId: scoredGame })).rejects.toThrow("Scores are already entered");
  }, 60_000);

  it("a FAILED count refuses — par/index are not reset under the entered score", async () => {
    const before = await schemaOf();
    const failing = callerFailingRead(ctx, "owner", { table: "score_entries", columns: "id" });
    await expect(failing.games.clearCourse({ tripId, gameId: scoredGame })).rejects.toThrow(SENTENCE("game's scores"));
    expect(await schemaOf()).toEqual(before);
  }, 60_000);
});

describe("games.update — a failed read never switches entry mode on a live game", () => {
  const modeOf = async () =>
    ((await ctx.admin.from("games").select("entry_mode").eq("id", scoredGame).single()).data as { entry_mode: string }).entry_mode;

  it("CONTROL: real reads — switching a live game's entry mode is refused", async () => {
    await expect(ctx.caller().games.update({ tripId, gameId: scoredGame, entryMode: "outcome" })).rejects.toThrow(
      "Switch back to setup before changing the entry mode.",
    );
  }, 60_000);

  it("a FAILED read refuses — the mode stays 'score'", async () => {
    const failing = callerFailingRead(ctx, "owner", { table: "games", columns: "scoring_enabled" });
    await expect(failing.games.update({ tripId, gameId: scoredGame, entryMode: "outcome" })).rejects.toThrow(SENTENCE("game"));
    expect(await modeOf()).toBe("score");
  }, 60_000);
});
