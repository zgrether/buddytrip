import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Score-entry permissions (SERVER) — the scoped model, DB-backed (exercises the
 * tRPC guard in scores.upsertEntry/deleteEntry AND the score_entries RLS, since
 * the caller writes through its own RLS-bound client):
 *   Owner / Organizer (co-admin) / delegate-of-this-game → any unit.
 *   Member → only the match/group they play in.
 *   Non-participant member → nothing.
 * The exhaustive per-format in/out-of-unit matrix is in src/lib/scoreUnit.test.ts
 * (pure); this proves the guard is WIRED on every format's write path.
 */
const STROKE = "gtt_stroke_play";
const SINGLES = "gtt_match_play";
const DOUBLES = "gtt_match_play";
const RACK = "gtt_rack_n_stack";

let ctx: TestContext;
let tripId: string;
let owner: string, planner: string, member: string, outsider: string;

type MatchRow = { id: string; side_a: { type: string; id: string } | null; side_b: { type: string; id: string } | null };

const FORBIDDEN = { code: "FORBIDDEN" };

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Score Perms Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // co-admin (elevated)
  await ctx.addTripMember(tripId, "member", "Member"); // plain member
  await ctx.addTripMember(tripId, "outsider", "Member"); // plain member
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("stroke — the unit is the individual player", () => {
  let gameId: string;
  beforeAll(async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Stroke Perms" });
    gameId = g.id;
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [member, outsider] });
    await ctx.caller().games.enableScoring({ tripId, gameId });
  });

  it("a member enters their OWN score", async () => {
    const e = await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "1", value: 4 });
    expect(e.value).toBe(4);
  });

  it("a member CANNOT enter another player's score", async () => {
    await expect(
      ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "1", value: 4 }),
    ).rejects.toMatchObject(FORBIDDEN);
  });

  it("a member CANNOT clear another player's score", async () => {
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "2", value: 5 });
    await expect(
      ctx.callerAs("member").scores.deleteEntry({ tripId, gameId, participantId: outsider, unitLabel: "2" }),
    ).rejects.toMatchObject(FORBIDDEN);
  });

  it("the owner enters anyone's score; the Organizer (co-admin) too", async () => {
    expect((await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "3", value: 4 })).value).toBe(4);
    expect((await ctx.callerAs("planner").scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "3", value: 5 })).value).toBe(5);
  });
});

describe("stroke — a non-participant member scores nothing", () => {
  let gameId: string;
  beforeAll(async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Stroke Solo" });
    gameId = g.id;
    // member + planner are the participants; outsider is deliberately NOT in this game.
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [member, planner] });
    await ctx.caller().games.enableScoring({ tripId, gameId });
  });

  it("a member not in the game cannot score its participants", async () => {
    await expect(
      ctx.callerAs("outsider").scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "1", value: 4 }),
    ).rejects.toMatchObject(FORBIDDEN);
  });

  it("a non-participant cannot score even their own id", async () => {
    await expect(
      ctx.callerAs("outsider").scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "1", value: 4 }),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("1v1 match — the unit is the match (its two players)", () => {
  let gameId: string;
  beforeAll(async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: SINGLES, name: "Singles Perms" });
    gameId = g.id;
    // Two matches (a cart, but no data link between them): m1 owner v planner, m2 member v outsider.
    await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [member] }, sideB: { members: [outsider] }, matchNumber: 2 },
      ],
    });
    await ctx.caller().games.enableScoring({ tripId, gameId });
  });

  it("a player scores BOTH players in their own match (one card per match)", async () => {
    expect((await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "1", value: 4 })).value).toBe(4);
    expect((await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "1", value: 5 })).value).toBe(5);
  });

  it("DEFERRED: a player CANNOT score the other 1v1 match in the cart", async () => {
    await expect(
      ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: owner, unitLabel: "1", value: 3 }),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(
      ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: planner, unitLabel: "1", value: 3 }),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("2v2 match — the unit is the match (its two side groups)", () => {
  let gameId: string, pgA: string, pgB: string;
  beforeAll(async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: DOUBLES, name: "Doubles Perms" });
    gameId = g.id;
    const matches = (await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 2, sideA: { members: [owner, planner] }, sideB: { members: [member, outsider] }, matchNumber: 1 }],
    })) as MatchRow[];
    pgA = matches[0].side_a!.id; // owner+planner
    pgB = matches[0].side_b!.id; // member+outsider
    await ctx.caller().games.enableScoring({ tripId, gameId });
  });

  it("a member scores BOTH sides of their match (their own + the opponent)", async () => {
    expect((await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: pgB, unitLabel: "1", value: 4, participantType: "play_group" })).value).toBe(4);
    expect((await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: pgA, unitLabel: "1", value: 5, participantType: "play_group" })).value).toBe(5);
  });
});

describe("rack — the unit is the play_group (cart)", () => {
  let gameId: string;
  beforeAll(async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: RACK, name: "Rack Perms" });
    gameId = g.id;
    // Two carts: g1 = member+outsider, g2 = owner+planner.
    await ctx.caller().playGroups.setFoursomes({
      tripId,
      gameId,
      groups: [{ userIds: [member, outsider] }, { userIds: [owner, planner] }],
    });
    await ctx.caller().games.enableScoring({ tripId, gameId });
  });

  it("a member scores anyone in their OWN cart", async () => {
    expect((await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: member, unitLabel: "1", value: 4 })).value).toBe(4);
    expect((await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: outsider, unitLabel: "1", value: 5 })).value).toBe(5);
  });

  it("a member CANNOT score a player in a DIFFERENT cart", async () => {
    await expect(
      ctx.callerAs("member").scores.upsertEntry({ tripId, gameId, participantId: owner, unitLabel: "1", value: 3 }),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("delegate — a game-organizer grant scores any unit, but only in THAT game", () => {
  let gameA: string, gameB: string;
  beforeAll(async () => {
    const a = await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Delegate A" });
    const b = await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: "Delegate B" });
    gameA = a.id;
    gameB = b.id;
    await ctx.caller().games.addParticipants({ tripId, gameId: gameA, userIds: [member, planner] });
    await ctx.caller().games.addParticipants({ tripId, gameId: gameB, userIds: [member, planner] });
    // outsider (a plain member, NOT a participant of either) is delegated to game A only.
    await ctx.admin.from("game_delegates").insert({ game_id: gameA, user_id: outsider });
    await ctx.caller().games.enableScoring({ tripId, gameId: gameA });
    await ctx.caller().games.enableScoring({ tripId, gameId: gameB });
  });
  afterAll(async () => {
    await ctx.admin.from("game_delegates").delete().eq("game_id", gameA);
  });

  it("the delegate scores any unit in THEIR game", async () => {
    expect((await ctx.callerAs("outsider").scores.upsertEntry({ tripId, gameId: gameA, participantId: member, unitLabel: "1", value: 4 })).value).toBe(4);
  });

  it("the SAME grant does NOT let them score a different game (game-isolated)", async () => {
    await expect(
      ctx.callerAs("outsider").scores.upsertEntry({ tripId, gameId: gameB, participantId: member, unitLabel: "1", value: 4 }),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});
