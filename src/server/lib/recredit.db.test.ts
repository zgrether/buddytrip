import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { recreditFixture } from "../../__tests__/helpers/recreditFixture";

/**
 * RE-CREDIT (PR 8c) through the tRPC procedures — what the app decides on top
 * of migration 204's contract (`recreditMigration.db.test.ts`):
 *   - the preview offers the right games: eligible ones with the BOARD's own
 *     before and after, and the ones that stand as played, with their reason;
 *   - confirm moves only the games the Owner ticked (game by game);
 *   - a stale preview comes back as a sentence the Owner can act on;
 *   - the board names who re-credited a game;
 *   - nobody but the Owner reaches the procedures.
 *
 * Each case builds its own cup: these are destructive writes (CLAUDE.md).
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

const preview = (c: { tripId: string; competitionId: string }, userId: string) =>
  ctx.caller().recredits.preview({ tripId: c.tripId, competitionId: c.competitionId, userId });

async function expectCode(p: Promise<unknown>, code: TRPCError["code"]) {
  await expect(p).rejects.toMatchObject({ code });
}

const pts = (rows: { teamId: string; points: number }[]) => Object.fromEntries(rows.map((t) => [t.teamId, t.points]));

describe("preview and confirm", () => {
  it("moves the planner's round from Alpha to Bravo — the board's before/after, the record, the board's note", async () => {
    const c = await f.finishedCup("Recredit moves");
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 11, [c.bravo]: 8 });

    // A setup error: the planner was always meant to be on Bravo.
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const p = await preview(c, f.planner);
    expect(p.toTeamId).toBe(c.bravo);
    expect(p.toTeamName).toBe("Bravo");
    expect(p.eligible.map((g) => g.gameId)).toEqual([c.gameId]);
    const g = p.eligible[0];
    expect(g.fromTeamId).toBe(c.alpha);
    expect(g.fromTeamName).toBe("Alpha");
    // Before: Bravo 8 beats Alpha 11 (low wins) → Bravo 10, Alpha 4.
    // After: Alpha 5, Bravo 14 → Alpha 10, Bravo 4. From the board's own maths.
    expect(pts(g.before)).toEqual({ [c.alpha]: 4, [c.bravo]: 10 });
    expect(pts(g.after)).toEqual({ [c.alpha]: 10, [c.bravo]: 4 });
    // The sentence that explains why moving him TO Bravo loses Bravo the game.
    expect(g.unequalTeams).toBe(
      "Bravo would have three players counting in Recredit moves round, Alpha one — in stroke play a team's total is its players' strokes added up, so the bigger team is at a disadvantage."
    );

    const res = await ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
      games: [{ gameId: c.gameId, fingerprint: g.fingerprint }],
    });
    expect(res.gameIds).toEqual([c.gameId]);
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 14 });

    const [rec] = await f.records(c.gameId);
    expect(rec).toMatchObject({ batch_id: res.batchId, recredited_by: f.owner });
    expect(pts(rec.before.teams)).toEqual({ [c.alpha]: 4, [c.bravo]: 10 });
    expect(pts(rec.after.teams)).toEqual({ [c.alpha]: 10, [c.bravo]: 4 });

    // The board names who did it, on that game's row — exactly the Owner's
    // name, never the "Someone" a failed name read would produce.
    const board = await ctx.callerAs("member").competitions.leaderboard({ tripId: c.tripId, competitionId: c.competitionId });
    const row = (board.games as { id: string; recredited?: { byName: string } | null }[]).find((x) => x.id === c.gameId);
    const { data: me } = await ctx.admin.from("users").select("name").eq("id", f.owner).single();
    expect(me?.name).toBeTruthy();
    expect(row?.recredited?.byName).toBe(me?.name);

    // And the person is no longer a candidate: their round now counts where they are.
    const cands = await ctx.caller().recredits.candidates({ tripId: c.tripId, competitionId: c.competitionId });
    expect(cands.userIds).not.toContain(f.planner);
  });

  it("CANDIDATES: exactly the people whose finished round counts somewhere they no longer are", async () => {
    const c = await f.finishedCup("Recredit candidates");
    expect((await ctx.caller().recredits.candidates({ tripId: c.tripId, competitionId: c.competitionId })).userIds).toEqual([]);
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    expect((await ctx.caller().recredits.candidates({ tripId: c.tripId, competitionId: c.competitionId })).userIds).toEqual([f.planner]);
  });

  it("to NO team: the preview says so, and confirm takes the round off every team", async () => {
    const c = await f.finishedCup("Recredit none");
    await f.moveTo(c.competitionId, f.planner, null);
    const p = await preview(c, f.planner);
    expect(p.toTeamId).toBeNull();
    expect(p.toTeamName).toBeNull();
    await ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: null,
      games: [{ gameId: c.gameId, fingerprint: p.eligible[0].fingerprint }],
    });
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 8 });
  });

  it("game by game: only the ticked round moves; the other stays where it was earned", async () => {
    const c = await f.finishedCup("Recredit one of two");
    const day2 = await f.finishedGame(c.tripId, c.competitionId, "Day 2 round");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const p = await preview(c, f.planner);
    expect(p.eligible.map((g) => g.gameId).sort()).toEqual([c.gameId, day2].sort());
    await ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
      games: [{ gameId: c.gameId, fingerprint: p.eligible.find((g) => g.gameId === c.gameId)!.fingerprint }],
    });
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 5, [c.bravo]: 14 });
    expect(await f.teamTotals(day2)).toEqual({ [c.alpha]: 11, [c.bravo]: 8 });
    expect(await f.records(day2)).toEqual([]);
  });

  it("STANDS AS PLAYED: a finished team-dependent game the person played is listed, not offered", async () => {
    const c = await f.finishedCup("Recredit standing");
    const manual = (await ctx.caller().games.create({
      tripId: c.tripId, gameTypeId: "gtt_manual", name: "Cornhole", competitionId: c.competitionId,
    })) as { id: string };
    await ctx.caller().games.addParticipants({ tripId: c.tripId, gameId: manual.id, userIds: [f.planner, f.member] });
    await ctx.caller().games.finish({
      tripId: c.tripId, gameId: manual.id,
      placements: [{ entityId: c.alpha, position: 1 }, { entityId: c.bravo, position: 2 }],
    });
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const p = await preview(c, f.planner);
    expect(p.eligible.map((g) => g.gameId)).toEqual([c.gameId]);
    expect(p.standing).toEqual([{ gameId: manual.id, name: "Cornhole", reason: "team_dependent" }]);
    // And confirm refuses it by name, before the database is asked.
    await expectCode(ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
      games: [{ gameId: manual.id, fingerprint: "x" }],
    }), "BAD_REQUEST");
  });
});

describe("a stale preview comes back as something to do", () => {
  it("a score correction after the preview: CONFLICT, 'open it again', and nothing moves", async () => {
    const c = await f.finishedCup("Recredit stale");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const g = (await preview(c, f.planner)).eligible[0];

    await ctx.caller().games.openCorrection({ tripId: c.tripId, gameId: c.gameId });
    await ctx.caller().scores.upsertEntry({ tripId: c.tripId, gameId: c.gameId, participantId: f.member, unitLabel: "1", value: 9 });
    await ctx.caller().games.finish({ tripId: c.tripId, gameId: c.gameId });
    const totals = await f.teamTotals(c.gameId);

    await expect(ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
      games: [{ gameId: c.gameId, fingerprint: g.fingerprint }],
    })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Open it again") });
    expect(await f.teamTotals(c.gameId)).toEqual(totals);
    expect(await f.records(c.gameId)).toEqual([]);
  });

  it("the person moved again after the preview", async () => {
    const c = await f.finishedCup("Recredit roster moved");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const g = (await preview(c, f.planner)).eligible[0];
    await f.moveTo(c.competitionId, f.planner, null);
    await expectCode(ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
      games: [{ gameId: c.gameId, fingerprint: g.fingerprint }],
    }), "CONFLICT");
    expect(await f.records(c.gameId)).toEqual([]);
  });

  it("a game opened for score edits: listed with that reason, and refused with it", async () => {
    const c = await f.finishedCup("Recredit in review");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const fp = (await preview(c, f.planner)).eligible[0].fingerprint;
    await ctx.caller().games.openCorrection({ tripId: c.tripId, gameId: c.gameId });

    const p = await preview(c, f.planner);
    expect(p.eligible).toEqual([]);
    expect(p.standing).toEqual([{ gameId: c.gameId, name: "Recredit in review round", reason: "in_review" }]);
    await expectCode(ctx.caller().recredits.confirm({
      tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
      games: [{ gameId: c.gameId, fingerprint: fp }],
    }), "PRECONDITION_FAILED");
  });
});

describe("Owner only", () => {
  it("an Organizer and a member are refused by every procedure", async () => {
    const c = await f.finishedCup("Recredit rights");
    await f.moveTo(c.competitionId, f.planner, c.bravo);
    const fp = (await preview(c, f.planner)).eligible[0].fingerprint;
    for (const role of ["planner", "member"] as const) {
      const as = ctx.callerAs(role).recredits;
      await expectCode(as.candidates({ tripId: c.tripId, competitionId: c.competitionId }), "FORBIDDEN");
      await expectCode(as.preview({ tripId: c.tripId, competitionId: c.competitionId, userId: f.planner }), "FORBIDDEN");
      await expectCode(as.confirm({
        tripId: c.tripId, competitionId: c.competitionId, userId: f.planner, expectedTeamId: c.bravo,
        games: [{ gameId: c.gameId, fingerprint: fp }],
      }), "FORBIDDEN");
    }
    expect(await f.records(c.gameId)).toEqual([]);
  });

  it("an Owner of ANOTHER trip cannot name this trip's cup", async () => {
    const c = await f.finishedCup("Recredit cross-trip");
    const mine = await ctx.createCupTrip({ name: "Recredit other trip", scoringModel: "points" });
    await expectCode(
      ctx.caller().recredits.preview({ tripId: mine.tripId, competitionId: c.competitionId, userId: f.planner }),
      "NOT_FOUND"
    );
  });
});
