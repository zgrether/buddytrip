import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const MATCH_PLAY = "gtt_match_play";

type Side = { type: string; id: string } | null;
interface MatchRow {
  id: string;
  side_a: Side;
  side_b: Side;
  result: string | null;
  margin: string | null;
  status: string;
  display_order: number;
}

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;

// Shared across both describes — cleanup only after the whole file.
beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Match Play Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member"); // 4th player for a full foursome
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("matches router (Slice B — setup + visibility)", () => {
  let gameId: string;
  let m1: string, m2: string;

  beforeAll(async () => {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Singles" });
    gameId = game.id;
  });

  it("setPairings — Organizer sets two matches; one with an empty slot", async () => {
    const matches = (await ctx.callerAs("planner").matches.setPairings({
      tripId,
      gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: null, matchNumber: 2 },
      ],
    })) as MatchRow[];
    expect(matches).toHaveLength(2);
    m1 = matches[0].id;
    m2 = matches[1].id;
    expect(matches[0].side_a?.id).toBe(owner);
    expect(matches[0].side_b?.id).toBe(member);
    expect(matches[1].side_b).toBeNull(); // TBD slot
  });

  it("setHandicap — recipient gets n, the other side gets 0 (never split)", async () => {
    await ctx.callerAs("planner").matches.setHandicap({
      tripId,
      gameId,
      matchId: m1,
      recipientId: member,
      strokes: 3,
    });
    const { data } = await ctx.admin
      .from("game_participants")
      .select("user_id, handicap_strokes")
      .eq("game_id", gameId);
    const hcap = Object.fromEntries(
      (data as { user_id: string; handicap_strokes: number | null }[]).map((p) => [
        p.user_id,
        p.handicap_strokes,
      ])
    );
    expect(hcap[member]).toBe(3);
    expect(hcap[owner]).toBe(0);
  });

  it("listByGame — a Member sees nothing before pairings are published", async () => {
    const res = await ctx.callerAs("member").matches.listByGame({ tripId, gameId });
    expect(res.published).toBe(false);
    expect(res.matches).toHaveLength(0);
  });

  it("listByGame — Owner/Organizer always see match detail (even unpublished)", async () => {
    const res = await ctx.callerAs("planner").matches.listByGame({ tripId, gameId });
    expect(res.published).toBe(false);
    expect(res.matches).toHaveLength(2);
  });

  it("enableScoring — readiness-gated; publishes + goes active; the Member can now see them", async () => {
    // A2-core: enable now (a) is refused until every match is paired (the server
    // readiness guard) and (b) the toggle OWNS status — Setup→Scoring sets
    // status:'active' (no longer "first score owns Live"). The shared fixture has an
    // empty slot, so use a dedicated game here to exercise both halves.
    const g = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name: "Enable Test" });
    // under-configured (one empty slot) → enable REFUSED
    await ctx.callerAs("planner").matches.setPairings({
      tripId, gameId: g.id,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: null, matchNumber: 1 }],
    });
    await expect(
      ctx.callerAs("planner").matches.enableScoring({ tripId, gameId: g.id })
    ).rejects.toThrow(/finish setting up/i);
    // fully paired → enable succeeds: publishes, member can see, status goes active
    await ctx.callerAs("planner").matches.setPairings({
      tripId, gameId: g.id,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    await ctx.callerAs("planner").matches.enableScoring({ tripId, gameId: g.id });
    const res = await ctx.callerAs("member").matches.listByGame({ tripId, gameId: g.id });
    expect(res.published).toBe(true);
    expect(res.matches).toHaveLength(1);
    const { data: game } = await ctx.admin.from("games").select("status, scoring_enabled").eq("id", g.id).single();
    expect((game as { scoring_enabled: boolean }).scoring_enabled).toBe(true);
    expect((game as { status: string }).status).toBe("active"); // A2-core: toggle owns status
  });

  it("assignPlayer — moving a player clears the vacated match's handicap", async () => {
    // member is in match 1 (side_b). Move them into match 2's empty slot.
    await ctx.callerAs("planner").matches.assignPlayer({
      tripId,
      gameId,
      matchId: m2,
      slot: "b",
      userId: member,
    });
    const { data: matches } = await ctx.admin
      .from("game_matches")
      .select("id, side_a, side_b")
      .eq("game_id", gameId);
    const byId = Object.fromEntries(
      (matches as { id: string; side_a: Side; side_b: Side }[]).map((r) => [r.id, r])
    );
    expect(byId[m1].side_b).toBeNull(); // vacated
    expect(byId[m2].side_b?.id).toBe(member); // moved here

    const { data: parts } = await ctx.admin
      .from("game_participants")
      .select("user_id, handicap_strokes")
      .eq("game_id", gameId);
    const hcap = Object.fromEntries(
      (parts as { user_id: string; handicap_strokes: number | null }[]).map((p) => [
        p.user_id,
        p.handicap_strokes,
      ])
    );
    // match 1's relationship is gone → both its players' handicaps cleared
    expect(hcap[member]).toBeNull();
    expect(hcap[owner]).toBeNull();
  });

  it("setup procedures reject a plain Member", async () => {
    await expect(
      ctx.callerAs("member").matches.setPairings({
        tripId,
        gameId,
        matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
      })
    ).rejects.toThrow();
    await expect(ctx.callerAs("member").matches.enableScoring({ tripId, gameId })).rejects.toThrow();
  });
});

describe("match-play results — computeMatchPlayResults via games.finish", () => {
  // Enter both sides' gross for the given holes. scoreA[h] / scoreB[h].
  async function enter(
    gameId: string,
    a: string,
    b: string,
    scoreA: Record<number, number>,
    scoreB: Record<number, number>
  ) {
    const caller = ctx.caller();
    // Phase 2B.1 universal gate: scoring must be enabled before entries land.
    await caller.games.enableScoring({ tripId, gameId });
    for (const [h, v] of Object.entries(scoreA)) {
      await caller.scores.upsertEntry({ tripId, gameId, participantId: a, unitLabel: h, value: v });
    }
    for (const [h, v] of Object.entries(scoreB)) {
      await caller.scores.upsertEntry({ tripId, gameId, participantId: b, unitLabel: h, value: v });
    }
  }

  async function freshGame(name: string) {
    const game = await ctx.caller().games.create({ tripId, gameTypeId: MATCH_PLAY, name });
    return game.id;
  }

  it("a closed-out match resolves to a_win / 3&2 with one game_results row per side", async () => {
    const gameId = await freshGame("Close 3&2");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    // owner wins holes 1-3, halves 4-16 → +3 frozen at hole 16 = 3&2.
    const aWins = { 1: 4, 2: 4, 3: 4 };
    const aHalf: Record<number, number> = {};
    const bHalf: Record<number, number> = {};
    for (let h = 4; h <= 16; h++) {
      aHalf[h] = 4;
      bHalf[h] = 4;
    }
    await enter(gameId, owner, member, { ...aWins, ...aHalf }, { 1: 5, 2: 5, 3: 5, ...bHalf });

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ result: "a_win", margin: "3&2", status: "complete" });

    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id, position, raw_score")
      .eq("game_id", gameId);
    const rows = results as { entity_id: string; position: number; raw_score: number | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.entity_id === owner)?.position).toBe(1);
    expect(rows.find((r) => r.entity_id === member)?.position).toBe(2);
    expect(rows.every((r) => r.raw_score === null)).toBe(true); // match play has no aggregate
  });

  it("9-hole round closes out — hole count comes from the schema, not a hardcoded 18", async () => {
    // The B1 regression: matchState used to hardcode 18, so a 9-hole match never
    // closed out (3 up with 2 to play through hole 7 of 9 would read holesLeft 11
    // and stay 'active' forever). The hole count must come from the game's
    // scorecard_schema unit count — the same source buildDecided already uses.
    const gameId = await freshGame("Nine-hole close");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    // Make it a 9-hole round (loadStrokeIndex reads units.count for the count).
    await ctx.admin.from("games").update({ scorecard_schema: { units: { count: 9 } } }).eq("id", gameId);

    // owner wins 1-3, halves 4-7 → +3 at hole 7 of 9 → holesLeft 2, closed 3&2.
    const aHalf: Record<number, number> = {};
    const bHalf: Record<number, number> = {};
    for (let h = 4; h <= 7; h++) {
      aHalf[h] = 4;
      bHalf[h] = 4;
    }
    await enter(gameId, owner, member, { 1: 4, 2: 4, 3: 4, ...aHalf }, { 1: 5, 2: 5, 3: 5, ...bHalf });

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    // Under the old 18-hole hardcode this stayed { result: null, status: "active" }.
    expect(matches[0]).toMatchObject({ result: "a_win", margin: "3&2", status: "complete" });
  });

  it("FREEZE — play-it-out holes after close-out never change the result", async () => {
    const gameId = await freshGame("Freeze");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const aHalf: Record<number, number> = {};
    const bHalf: Record<number, number> = {};
    for (let h = 4; h <= 16; h++) {
      aHalf[h] = 4;
      bHalf[h] = 4;
    }
    // close 3&2, then member wins 17 & 18 (play-it-out)
    await enter(
      gameId,
      owner,
      member,
      { 1: 4, 2: 4, 3: 4, ...aHalf, 17: 6, 18: 6 },
      { 1: 5, 2: 5, 3: 5, ...bHalf, 17: 3, 18: 3 }
    );

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches[0]).toMatchObject({ result: "a_win", margin: "3&2" }); // still 3&2, not recomputed
  });

  // ── Glorious Finishing Holes — the weighted last-N result via the SAME finish
  // path. "Real data": modifiers persisted on the game, scores in score_entries,
  // computeMatchPlayResults reads the live config. Proves the down-6-comeback and
  // the 4-up-stays-live cases end-to-end, each against a no-glorious control.
  async function pairOwnerMember(gameId: string) {
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
  }
  // A is 6 DOWN thru 15 (loses 1–6, halves 7–15), then A wins 16/17/18.
  function downSixThenWinLast(): [Record<number, number>, Record<number, number>] {
    const a: Record<number, number> = {};
    const b: Record<number, number> = {};
    for (let h = 1; h <= 6; h++) { a[h] = 5; b[h] = 4; } // A loses 1–6
    for (let h = 7; h <= 15; h++) { a[h] = 4; b[h] = 4; } // halved 7–15
    a[16] = 4; a[17] = 4; a[18] = 4; // A wins the last three…
    b[16] = 5; b[17] = 5; b[18] = 5;
    return [a, b];
  }
  // A is 4 UP thru 15 (wins 1–4, halves 5–15); only 15 holes entered.
  function fourUpThru15(): [Record<number, number>, Record<number, number>] {
    const a: Record<number, number> = {};
    const b: Record<number, number> = {};
    for (let h = 1; h <= 4; h++) { a[h] = 4; b[h] = 5; }
    for (let h = 5; h <= 15; h++) { a[h] = 4; b[h] = 4; }
    return [a, b];
  }

  it("GLORIOUS N=3 — 6 down thru 15, wins 16/17/18 → HALVE (the three ±2 swings square it)", async () => {
    const gameId = await freshGame("Glorious comeback");
    await ctx.caller().games.update({ tripId, gameId, modifiers: { glorious_holes: { holes: 3 } } });
    await pairOwnerMember(gameId);
    const [a, b] = downSixThenWinLast();
    await enter(gameId, owner, member, a, b);
    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches[0]).toMatchObject({ result: "halve", status: "complete" });
  });

  it("CONTROL — same scores, no glorious → b_win (A eliminated at hole 13, comeback never counts)", async () => {
    const gameId = await freshGame("No-glorious control");
    await pairOwnerMember(gameId);
    const [a, b] = downSixThenWinLast();
    await enter(gameId, owner, member, a, b);
    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches[0]).toMatchObject({ result: "b_win", margin: "6&5", status: "complete" });
  });

  it("GLORIOUS N=3 — 4 up thru 15 stays LIVE (weighted swing 6 ≥ lead 4) → not decided", async () => {
    const gameId = await freshGame("Glorious four-up live");
    await ctx.caller().games.update({ tripId, gameId, modifiers: { glorious_holes: { holes: 3 } } });
    await pairOwnerMember(gameId);
    const [a, b] = fourUpThru15();
    await enter(gameId, owner, member, a, b);
    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches[0]).toMatchObject({ result: null, status: "active" }); // NOT closed out
  });

  it("CONTROL — same 4-up-thru-15, no glorious → a_win 4&3 (raw swing 3 < lead 4 → closed)", async () => {
    const gameId = await freshGame("Four-up closed control");
    await pairOwnerMember(gameId);
    const [a, b] = fourUpThru15();
    await enter(gameId, owner, member, a, b);
    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    expect(matches[0]).toMatchObject({ result: "a_win", margin: "4&3", status: "complete" });
  });

  it("net allocation (fallback) — a received stroke flips a hole", async () => {
    const gameId = await freshGame("Net stroke");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    // member gets 1 stroke → fallback puts it on hole 1.
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId: (await firstMatchId(gameId)), recipientId: member, strokes: 1 });
    // hole 1: owner 4, member 5 → gross owner wins, but member's net 4 → halved.
    await enter(gameId, owner, member, { 1: 4 }, { 1: 5 });

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    // one decided hole, halved → all square through 18 is not reached; in-progress
    // halve means diff 0, not over → result null but the hole was a halve (net).
    // Assert via game_results that neither side leads (both position 1).
    const { data: results } = await ctx.admin
      .from("game_results")
      .select("entity_id, position")
      .eq("game_id", gameId);
    const rows = results as { entity_id: string; position: number }[];
    expect(rows.find((r) => r.entity_id === owner)?.position).toBe(1);
    expect(rows.find((r) => r.entity_id === member)?.position).toBe(1);
    expect(matches[0].result).toBeNull(); // not over yet
  });

  it("two matches in one game compute independently", async () => {
    const gameId = await freshGame("Two matches");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    });
    // Match 1: owner wins holes 1-10 → closes 10&8. Match 2: only hole 1 entered → in progress.
    const aWins: Record<number, number> = {};
    const bLoss: Record<number, number> = {};
    for (let h = 1; h <= 10; h++) {
      aWins[h] = 3;
      bLoss[h] = 5;
    }
    await enter(gameId, owner, member, aWins, bLoss);
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: planner, unitLabel: "1", value: 4 });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "1", value: 5 });

    const { matches } = await ctx.caller().games.finish({ tripId, gameId });
    const byOrder = (matches as { matchId: string; result: string | null; status: string }[]);
    // sorted by nothing in particular; find the closed one + the open one
    expect(byOrder.some((m) => m.result === "a_win" && m.status === "complete")).toBe(true);
    expect(byOrder.some((m) => m.result === null && m.status === "active")).toBe(true);
  });

  async function firstMatchId(gameId: string): Promise<string> {
    const { data } = await ctx.admin.from("game_matches").select("id").eq("game_id", gameId).limit(1).single();
    return (data as { id: string }).id;
  }

  async function positionOf(gameId: string, entityId: string): Promise<number | undefined> {
    const { data } = await ctx.admin
      .from("game_results")
      .select("entity_id, position")
      .eq("game_id", gameId);
    return (data as { entity_id: string; position: number }[]).find((r) => r.entity_id === entityId)?.position;
  }

  it("editing a handicap on an in-progress match re-derives its hole results", async () => {
    const gameId = await freshGame("Handicap re-derive");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = await firstMatchId(gameId);
    // Hole 1: owner 5, member 4 → with no strokes, member wins the hole.
    await enter(gameId, owner, member, { 1: 5 }, { 1: 4 });
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId, recipientId: member, strokes: 0 });
    expect(await positionOf(gameId, member)).toBe(1); // member leads
    expect(await positionOf(gameId, owner)).toBe(2);

    // Give OWNER a stroke on hole 1 (fallback) → owner net 4 = member 4 → halved.
    // The previously-shown member win must NOT persist — the result re-derives.
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId, recipientId: owner, strokes: 1 });
    expect(await positionOf(gameId, owner)).toBe(1); // all square now
    expect(await positionOf(gameId, member)).toBe(1);
  });

  it("a late handicap edit does NOT rewrite a complete (frozen) match", async () => {
    const gameId = await freshGame("Freeze on edit");
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = await firstMatchId(gameId);
    // Close 3&2: owner wins 1-3, halves 4-16.
    const aHalf: Record<number, number> = {};
    const bHalf: Record<number, number> = {};
    for (let h = 4; h <= 16; h++) {
      aHalf[h] = 4;
      bHalf[h] = 4;
    }
    await enter(gameId, owner, member, { 1: 4, 2: 4, 3: 4, ...aHalf }, { 1: 5, 2: 5, 3: 5, ...bHalf });
    await ctx.caller().games.finish({ tripId, gameId }); // status → complete, a_win 3&2

    // A big late handicap to member would change earlier holes — but the match
    // is frozen, so its recorded result must be untouched.
    await ctx.caller().matches.setHandicap({ tripId, gameId, matchId, recipientId: member, strokes: 18 });
    const { data } = await ctx.admin.from("game_matches").select("result, margin, status").eq("id", matchId).single();
    expect(data).toMatchObject({ result: "a_win", margin: "3&2", status: "complete" });
  });
});
