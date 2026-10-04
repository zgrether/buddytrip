import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { recreditFixture } from "../../__tests__/helpers/recreditFixture";
import { recreditTeamRows, recreditedRoster } from "@/lib/recredit";

/**
 * Migration 204's database contract for re-credit, on its own — direct calls
 * to `recredit_games` and `recredit_fingerprints`, no tRPC procedure involved,
 * so it holds whatever code calls them (the migration lands ahead of the app
 * code that uses it, CLAUDE.md step 3).
 *
 * What only the database can promise, each with the mutant that proved the
 * case can fail (the 8c campaign):
 *   - the STORED roster moves with the team rows, so a later score correction
 *     credits through the re-credit rather than putting it back (M1);
 *   - a team-dependent format is refused (M2), and only the trip Owner gets in
 *     (M3);
 *   - a stale fingerprint refuses the batch, all of it (M4);
 *   - a game open for score edits is refused (M7);
 *   - a scoring reset clears the game's re-credits (M5);
 *   - members read the record, an outsider does not (M6), nobody writes it;
 *   - the guest merge re-keys both person columns (M8, M9).
 */

let ctx: TestContext;
let f: ReturnType<typeof recreditFixture>;

beforeAll(async () => {
  ctx = await TestContext.create();
  f = recreditFixture(ctx);
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function fingerprint(competitionId: string, gameId: string): Promise<string> {
  const { data, error } = await ctx.authedClient("owner").rpc("recredit_fingerprints", { p_competition_id: competitionId });
  if (error) throw error;
  const row = (data as { game_id: string; fingerprint: string }[]).find((r) => r.game_id === gameId);
  if (!row) throw new Error("no fingerprint for the game");
  return row.fingerprint;
}

/** The team rows through the roster with `userId` on `toTeam` — what the app
 *  sends, built by the same pure function. */
async function teamRowsAfter(gameId: string, userId: string, toTeam: string | null) {
  const { data, error } = await ctx.admin
    .from("game_results").select("entity_id, raw_score, position").eq("game_id", gameId).eq("entity_type", "user");
  if (error) throw error;
  const roster = await f.creditedRoster(gameId);
  return recreditTeamRows(data ?? [], recreditedRoster(roster, userId, toTeam), "traditional");
}

async function recredit(
  role: "owner" | "planner" | "member",
  c: { competitionId: string },
  userId: string,
  expectedTeam: string | null,
  items: { game_id: string; fingerprint: string; team_rows?: unknown[] }[]
) {
  return ctx.authedClient(role).rpc("recredit_games", {
    p_competition_id: c.competitionId, p_user_id: userId, p_expected_team_id: expectedTeam,
    p_items: items.map((i) => ({ team_rows: [], before: { teams: [] }, after: { teams: [] }, ...i })),
  });
}

describe("recredit_games moves the stored roster, the team rows and the record together", () => {
  it("moves the planner's round to Bravo, and a later score correction keeps it there", async () => {
    const c = await f.finishedCup("Mig moves");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const { error, data: batch } = await recredit("owner", c, f.planner, c.bravo, [{
      game_id: c.gameId,
      fingerprint: await fingerprint(c.competitionId, c.gameId),
      team_rows: await teamRowsAfter(c.gameId, f.planner, c.bravo),
    }]);
    expect(error).toBeNull();
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 14 });
    expect((await f.creditedRoster(c.gameId))[f.planner]).toBe(c.bravo);
    expect(await f.records(c.gameId)).toEqual([
      expect.objectContaining({
        batch_id: batch, user_id: f.planner, recredited_by: f.owner,
        from_team_id: c.alpha, from_team_name: "Alpha", to_team_id: c.bravo, to_team_name: "Bravo",
      }),
    ]);

    // The planner's hole 1 goes from 6 to 7 and the round re-finalizes. Through
    // the re-credited roster: Bravo 15. Through the first roster: Alpha 12.
    await ctx.caller().games.openCorrection({ tripId: c.tripId, gameId: c.gameId });
    await ctx.caller().scores.upsertEntry({ tripId: c.tripId, gameId: c.gameId, participantId: f.planner, unitLabel: "1", value: 7 });
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 15 });
  });

  it("to NO team: the person leaves the stored roster, and their own result stays", async () => {
    const c = await f.finishedCup("Mig none");
    await f.moveTo(c.competitionId, f.planner, null);
    const { error } = await recredit("owner", c, f.planner, null, [{
      game_id: c.gameId,
      fingerprint: await fingerprint(c.competitionId, c.gameId),
      team_rows: await teamRowsAfter(c.gameId, f.planner, null),
    }]);
    expect(error).toBeNull();
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 8 });
    expect(await f.creditedRoster(c.gameId)).not.toHaveProperty(f.planner);
    expect((await f.records(c.gameId))[0]).toMatchObject({ to_team_id: null, to_team_name: null });
  });
});

describe("recredit_games refuses — and a refusal writes nothing", () => {
  it("a stale fingerprint in a batch refuses the whole batch", async () => {
    const c = await f.finishedCup("Mig batch");
    const day2 = await f.finishedGame(c.tripId, c.competitionId, "Mig day 2");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const { error } = await recredit("owner", c, f.planner, c.bravo, [
      { game_id: c.gameId, fingerprint: await fingerprint(c.competitionId, c.gameId), team_rows: await teamRowsAfter(c.gameId, f.planner, c.bravo) },
      { game_id: day2, fingerprint: "stale" },
    ]);
    expect(error?.message).toContain("RECREDIT_RESULTS_CHANGED");
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 11, [c.bravo]: 8 });
    expect((await f.creditedRoster(c.gameId))[f.planner]).toBe(c.alpha);
    expect(await f.records(c.gameId)).toEqual([]);
  });

  it("the person's team is not the one the preview saw", async () => {
    const c = await f.finishedCup("Mig roster");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const { error } = await recredit("owner", c, f.planner, null, [
      { game_id: c.gameId, fingerprint: await fingerprint(c.competitionId, c.gameId) },
    ]);
    expect(error?.message).toContain("RECREDIT_ROSTER_CHANGED");
  });

  it("a game open for score edits", async () => {
    const c = await f.finishedCup("Mig review");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const fp = await fingerprint(c.competitionId, c.gameId);
    await ctx.caller().games.openCorrection({ tripId: c.tripId, gameId: c.gameId });
    const { error } = await recredit("owner", c, f.planner, c.bravo, [{ game_id: c.gameId, fingerprint: fp }]);
    expect(error?.message).toContain("RECREDIT_IN_REVIEW");
    expect(await f.records(c.gameId)).toEqual([]);
  });

  it("a team-dependent format — with a CONTROL showing the stroke round gets past that check", async () => {
    const c = await f.finishedCup("Mig dependent");
    const manual = (await ctx.caller().games.create({
      tripId: c.tripId, gameTypeId: "gtt_manual", name: "Cornhole", competitionId: c.competitionId,
    })) as { id: string };
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const refused = await recredit("owner", c, f.planner, c.bravo, [{ game_id: manual.id, fingerprint: "x" }]);
    expect(refused.error?.message).toContain("RECREDIT_TEAM_DEPENDENT");
    const control = await recredit("owner", c, f.planner, c.bravo, [{ game_id: c.gameId, fingerprint: "x" }]);
    expect(control.error?.message).toContain("RECREDIT_RESULTS_CHANGED");
  });

  it("someone with no result in the game: their credit moving would describe nothing", async () => {
    const c = await f.finishedCup("Mig no result");
    const ghost = `ghost-${crypto.randomUUID()}`;
    const u = await ctx.admin.from("users").insert({ id: ghost, name: "Late add", is_guest: true });
    if (u.error) throw u.error;
    const a = await ctx.admin.from("team_assignments").insert({ competition_id: c.competitionId, user_id: ghost, team_id: c.bravo });
    if (a.error) throw a.error;
    const { error } = await recredit("owner", c, ghost, c.bravo, [
      { game_id: c.gameId, fingerprint: await fingerprint(c.competitionId, c.gameId) },
    ]);
    expect(error?.message).toContain("RECREDIT_NO_RESULT");
    await ctx.admin.from("team_assignments").delete().eq("user_id", ghost);
    await ctx.admin.from("users").delete().eq("id", ghost);
  });

  it("a team row naming another cup's team", async () => {
    const c = await f.finishedCup("Mig bad row");
    const other = await f.finishedCup("Mig other cup");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const rows = await teamRowsAfter(c.gameId, f.planner, c.bravo);
    rows[0] = { ...rows[0], entity_id: other.alpha, credited_team_id: other.alpha };
    const { error } = await recredit("owner", c, f.planner, c.bravo, [
      { game_id: c.gameId, fingerprint: await fingerprint(c.competitionId, c.gameId), team_rows: rows },
    ]);
    expect(error?.message).toContain("RECREDIT_BAD_TEAM_ROW");
    expect(await f.records(c.gameId)).toEqual([]);
  });
});

describe("Owner only, inside both functions", () => {
  it("an Organizer and a member are refused, and the game is untouched", async () => {
    const c = await f.finishedCup("Mig rights");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const fp = await fingerprint(c.competitionId, c.gameId);
    for (const role of ["planner", "member"] as const) {
      const r = await recredit(role, c, f.planner, c.bravo, [{ game_id: c.gameId, fingerprint: fp }]);
      expect(r.error?.message).toContain("RECREDIT_OWNER_ONLY");
      const p = await ctx.authedClient(role).rpc("recredit_fingerprints", { p_competition_id: c.competitionId });
      expect(p.error?.message).toContain("RECREDIT_OWNER_ONLY");
    }
    expect(await f.records(c.gameId)).toEqual([]);
    expect((await f.creditedRoster(c.gameId))[f.planner]).toBe(c.alpha);
  });
});

describe("game_recredits: grants, visibility, reset and merge", () => {
  async function recredited(name: string) {
    const c = await f.finishedCup(name);
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const { error } = await recredit("owner", c, f.planner, c.bravo, [{
      game_id: c.gameId,
      fingerprint: await fingerprint(c.competitionId, c.gameId),
      team_rows: await teamRowsAfter(c.gameId, f.planner, c.bravo),
    }]);
    if (error) throw error;
    return c;
  }

  it("a member reads it; someone off the trip does not; nobody inserts directly", async () => {
    const c = await recredited("Mig visibility");
    const asMember = await ctx.authedClient("member").from("game_recredits").select("id").eq("game_id", c.gameId);
    expect(asMember.data).toHaveLength(1);

    const off = await ctx.admin.from("trip_members").delete().eq("trip_id", c.tripId).eq("user_id", f.outsider);
    if (off.error) throw off.error;
    const asOutsider = await ctx.authedClient("outsider").from("game_recredits").select("id").eq("game_id", c.gameId);
    expect(asOutsider.error).toBeNull();
    expect(asOutsider.data).toEqual([]);

    const write = await ctx.authedClient("owner").from("game_recredits").insert({
      batch_id: "b", game_id: c.gameId, competition_id: c.competitionId, user_id: f.planner, before: {}, after: {},
    });
    // Refused on PRIVILEGE (42501), before RLS: the grant is SELECT only.
    expect(write.error?.code).toBe("42501");
  });

  it("a scoring reset deletes the game's re-credits", async () => {
    const c = await recredited("Mig reset");
    expect(await f.records(c.gameId)).toHaveLength(1);
    const { error } = await ctx.admin.rpc("_reset_game_scoring", { p_game_id: c.gameId });
    expect(error).toBeNull();
    expect(await f.records(c.gameId)).toEqual([]);
  });

  it("the guest merge moves both person columns, and the record survives the placeholder's deletion", async () => {
    const c = await f.finishedCup("Mig merge");
    const ghost = `ghost-${crypto.randomUUID()}`;
    const ghostOwner = `ghost-${crypto.randomUUID()}`;
    const real = await ctx.createAccount("recredit-merge");
    const realOwner = await ctx.createAccount("recredit-merge-owner");
    for (const id of [ghost, ghostOwner]) {
      const { error } = await ctx.admin.from("users").insert({ id, name: "Placeholder", is_guest: true });
      if (error) throw error;
    }
    // Stored state: both person columns name placeholders.
    const ins = await ctx.admin.from("game_recredits").insert({
      batch_id: "merge", game_id: c.gameId, competition_id: c.competitionId,
      user_id: ghost, recredited_by: ghostOwner, before: {}, after: {},
    });
    if (ins.error) throw ins.error;
    for (const [g, r] of [[ghost, real.id], [ghostOwner, realOwner.id]] as const) {
      const { error } = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: g, p_real_id: r });
      expect(error).toBeNull();
    }
    // Without the merge lines the deletion CASCADEs the row away (user_id) or
    // blanks its author (recredited_by).
    expect(await f.records(c.gameId)).toEqual([
      expect.objectContaining({ user_id: real.id, recredited_by: realOwner.id }),
    ]);
  });
});
