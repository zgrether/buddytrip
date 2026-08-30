import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

/**
 * save_game_config — the Matches STRUCTURE freeze (migration 171).
 *
 * Phase 0 §3 / build spec §5.1, the "careful part" of the Matches build:
 * `v_has_scores` (`score_entries` OR `match_hole_outcomes`) is FALSE for a
 * Matches game with a decided match, because a Matches result is DECLARED
 * straight to `game_matches.result` — no scores, no hole outcomes. Left alone,
 * a re-pair (structure-dirty Save) would clean-replace every `game_matches`
 * row, minting fresh ids and moving a recorded result onto DIFFERENT PEOPLE,
 * invisibly. This pins the fix: a decided match refuses a re-pair outright,
 * with a message naming a real action (`Reset scores` in the Danger zone,
 * which DOES clear `game_matches.result` too — `_reset_game_scoring`, 162) —
 * not `HAS_SCORES`'s wording, which sends the reader to check for scores that
 * don't exist.
 *
 * MECHANISM, not outcome: every "refused" case also asserts the decided row
 * survives byte-identical, and the message is asserted by CODE (`MATCH_DECIDED`,
 * not `HAS_SCORES`) — a weaker `.rejects.toThrow()` alone would pass against a
 * build that reused HAS_SCORES's message, which is exactly the wrong-object
 * failure this migration exists to fix.
 */

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let owner: string, member: string;
const gameIds: string[] = [];

async function newMatchesGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

async function hashOf(gameId: string): Promise<string> {
  return (await ctx.caller().games.configHash({ tripId, gameId })).hash;
}

interface MatchSlice {
  matchNumber: number;
  a: string[];
  b: string[];
}

/** The full non-golf payload plus the matches slice — echoes the game's
 *  current scalars so a save changes ONLY what's overridden, mirroring the
 *  bracket suite's `payloadFor`. */
async function payloadFor(gameId: string, matches: MatchSlice[]) {
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
    delegates: [],
    competitionFormat: MATCHES_COMPETITION_FORMAT,
    matches: matches.map((m) => ({
      matchNumber: m.matchNumber,
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

async function save(gameId: string, matches: MatchSlice[]) {
  return ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: await hashOf(gameId),
    payload: await payloadFor(gameId, matches),
  });
}

async function matchesOf(gameId: string) {
  const { data } = await ctx.admin
    .from("game_matches")
    .select("id, match_number, side_a, side_b, result, status")
    .eq("game_id", gameId)
    .order("match_number");
  return data ?? [];
}

/** Simulates a declared result — the write path `NonGolfMatchControl` will use,
 *  which is not what this migration is about; this test is about what happens
 *  AFTER a result exists, however it got there. */
async function declareResult(matchId: string, result: "a_win" | "b_win" | "halve") {
  await ctx.admin.from("game_matches").update({ result, status: "complete" }).eq("id", matchId);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("saveConfig Matches Trip");
  await ctx.addTripMember(tripId, "member", "Member");
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
});

afterAll(async () => {
  if (gameIds.length > 0) {
    await ctx.admin.from("game_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
});

describe("save_game_config — a decided Matches match refuses re-pairing (171)", () => {
  it("a game with NO decided matches re-pairs cleanly — the guard is not over-eager", async () => {
    const gameId = await newMatchesGame("Clean re-pair");
    await save(gameId, [{ matchNumber: 1, a: [owner], b: [member] }]);
    const rows = await matchesOf(gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBeNull();

    // Re-pair again — still nothing decided, still permitted.
    await save(gameId, [{ matchNumber: 1, a: [member], b: [owner] }]);
    const rows2 = await matchesOf(gameId);
    expect(rows2).toHaveLength(1);
    expect((rows2[0].side_a as { id: string }).id).toBe(member);
  });

  it("a DECIDED match refuses a re-pair, by the RIGHT error code", async () => {
    const gameId = await newMatchesGame("Decided refuses");
    await save(gameId, [{ matchNumber: 1, a: [owner], b: [member] }]);
    const [row] = await matchesOf(gameId);
    await declareResult(row.id as string, "a_win");

    // Sanity: this game genuinely has no score_entries/match_hole_outcomes —
    // proving v_has_scores is FALSE here, which is the whole reason a NEW
    // guard was needed rather than relying on the existing one.
    const { count: scoreCount } = await ctx.admin
      .from("score_entries")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId);
    expect(scoreCount).toBe(0);

    await expect(save(gameId, [{ matchNumber: 1, a: [member], b: [owner] }])).rejects.toThrow(
      /have been decided/i
    );
    // NOT the HAS_SCORES wording — the wrong-object failure this exists to fix.
    await expect(save(gameId, [{ matchNumber: 1, a: [member], b: [owner] }])).rejects.not.toThrow(
      /this game already has scores/i
    );

    // The refused write touched NOTHING — the decided row survives byte-identical.
    const [after] = await matchesOf(gameId);
    expect(after.id).toBe(row.id);
    expect(after.result).toBe("a_win");
    expect((after.side_a as { id: string }).id).toBe(owner);
  });

  it("the refusal names a REACHABLE action — Reset scores really does clear a Matches result", async () => {
    // CLAUDE.md's own recorded failure mode: a refusal must not send the reader
    // somewhere that can't fix it. Confirms the Danger Zone action this
    // message points to actually clears what's holding the freeze.
    const gameId = await newMatchesGame("Reset clears it");
    await save(gameId, [{ matchNumber: 1, a: [owner], b: [member] }]);
    const [row] = await matchesOf(gameId);
    await declareResult(row.id as string, "a_win");

    await ctx.caller().games.resetScoring({ tripId, gameId });

    const [after] = await matchesOf(gameId);
    expect(after.result).toBeNull();
    expect(after.status).toBe("pending");

    // And now the SAME re-pair the earlier test refused goes through.
    await save(gameId, [{ matchNumber: 1, a: [member], b: [owner] }]);
    const rows = await matchesOf(gameId);
    expect((rows[0].side_a as { id: string }).id).toBe(member);
  });

  it("a match with an assigned but UNDECIDED result re-pairs freely — only a RESULT freezes it", async () => {
    // Distinguishes "assigned" from "decided" — an unresolved pairing is
    // ordinary mid-setup state, not a freeze condition.
    const gameId = await newMatchesGame("Undecided repairs");
    await save(gameId, [{ matchNumber: 1, a: [owner], b: [member] }]);
    await save(gameId, [{ matchNumber: 1, a: [member], b: [owner] }]);
    const rows = await matchesOf(gameId);
    expect(rows[0].result).toBeNull();
    expect((rows[0].side_a as { id: string }).id).toBe(member);
  });
});
