import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";
import { saveConstraintMessage } from "../lib/saveConstraintMessage";
import { callerFailingRpc } from "../../__tests__/helpers/failingRead";

/**
 * #1506 — a DATABASE CONSTRAINT failure on a settings save says what actually
 * happened, not "Reload and try again".
 *
 * Each case first sends the payload to the RPC directly and asserts the
 * SQLSTATE it raises. That proves the fixture really reaches the constraint,
 * so the mapping assertion after it cannot pass for some other reason (a
 * prefixed refusal, a validation error). Then the same payload goes through
 * `games.saveConfig`, the path the settings page uses.
 *
 * The 23503 fixture is #1032's real shape: a match side naming a user row
 * that does not exist, which the clean-replace re-inserts into
 * `game_participants`.
 */

const CARD = "gtt_generic_card";
const GENERIC = "That change couldn't be saved. Reload and try again.";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let owner: string, member: string;
const gameIds: string[] = [];

async function newGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, competitionId, gameTypeId: CARD, name })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

/** The full non-golf payload, echoing the game's scalars; only the slices
 *  under test are overridden. Same shape as the Matches suite's `payloadFor`. */
async function payloadFor(gameId: string, over: { matches?: { a: string[]; b: string[] }[]; delegates?: string[] }) {
  const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
  return {
    name: (g.name as string) ?? "Matches",
    rulesForToday: (g.rules_for_today as string | null) ?? null,
    scoringEnabled: (g.scoring_enabled as boolean) ?? false,
    pointsTotal: (g.points_total as number | null) ?? 4,
    pointsDistribution: g.points_distribution ?? null,
    courseId: null,
    backCourseId: null,
    scorecardSchema: null,
    delegates: over.delegates ?? [],
    competitionFormat: MATCHES_COMPETITION_FORMAT,
    matches: (over.matches ?? []).map((m, i) => ({
      matchNumber: i + 1,
      playersPerSide: 1 as const,
      a: m.a,
      b: m.b,
      strokesA: 0,
      strokesB: 0,
      pointValue: null,
    })),
    matchesStructureDirty: true,
  };
}

async function rawRpcCode(gameId: string, payload: unknown): Promise<string | null> {
  const { error } = await ctx
    .authedClient("owner")
    .rpc("save_game_config", { p_trip_id: tripId, p_game_id: gameId, p_payload: payload });
  return error?.code ?? null;
}

async function saveThroughRouter(gameId: string, payload: unknown) {
  return ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: (await ctx.caller().games.configHash({ tripId, gameId })).hash,
    payload: payload as never,
  });
}

beforeAll(async () => {
  ctx = await TestContext.create();
  ({ tripId, competitionId } = await ctx.createCupTrip({
    name: "saveConfig constraints",
    scoringModel: "points",
    teams: ["Team A", "Team B"],
    members: [["member", "Member"]],
  }));
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

describe("saveConstraintMessage", () => {
  it("maps 23503 and 23505, each to its own sentence that says reloading won't help", () => {
    const fk = saveConstraintMessage("23503");
    const dup = saveConstraintMessage("23505");
    expect(fk).toContain("no longer exists");
    expect(dup).toContain("lists something twice");
    for (const m of [fk, dup]) {
      expect(m).toContain("Reloading won't fix it");
      expect(m).toContain("Send feedback");
      expect(m).not.toContain("try again");
    }
  });

  it("CONTROL: anything else is left to the existing arms", () => {
    for (const code of [undefined, null, "", "P0001", "23514", "40001", "PGRST116"]) {
      expect(saveConstraintMessage(code)).toBeNull();
    }
  });
});

describe("games.saveConfig through the real RPC (#1506)", () => {
  it("a match side naming a user that doesn't exist: 23503, and the reader is told what happened", async () => {
    const gameId = await newGame("Dangling side");
    const payload = await payloadFor(gameId, { matches: [{ a: [owner], b: ["user-that-does-not-exist-1506"] }] });

    expect(await rawRpcCode(gameId, payload), "the fixture must reach the foreign key").toBe("23503");

    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(saveThroughRouter(gameId, payload)).rejects.toMatchObject({
      code: "CONFLICT",
      message: saveConstraintMessage("23503"),
    });
    vi.restoreAllMocks();
  }, 60_000);

  it("the same person named twice as a delegate: 23505, and the reader is told what happened", async () => {
    const gameId = await newGame("Duplicate delegate");
    const payload = await payloadFor(gameId, { delegates: [member, member] });

    expect(await rawRpcCode(gameId, payload), "the fixture must reach the unique key").toBe("23505");

    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(saveThroughRouter(gameId, payload)).rejects.toMatchObject({
      code: "CONFLICT",
      message: saveConstraintMessage("23505"),
    });
    vi.restoreAllMocks();
  }, 60_000);

  it("CONTROL: a valid save still goes through", async () => {
    const gameId = await newGame("Valid");
    const payload = await payloadFor(gameId, { matches: [{ a: [owner], b: [member] }], delegates: [member] });
    expect(await rawRpcCode(gameId, payload)).toBeNull();
  }, 60_000);

  it("CONTROL: any other database error still reaches the generic arm", async () => {
    // PGRST003 has no CODE: prefix and is not a constraint, so it must fall
    // through to the generic sentence, as before.
    const gameId = await newGame("Other failure");
    const payload = await payloadFor(gameId, {});
    const baseHash = (await ctx.caller().games.configHash({ tripId, gameId })).hash;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      callerFailingRpc(ctx, "owner", "save_game_config").games.saveConfig({ tripId, gameId, baseHash, payload: payload as never })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: GENERIC });
    vi.restoreAllMocks();
  }, 60_000);
});
